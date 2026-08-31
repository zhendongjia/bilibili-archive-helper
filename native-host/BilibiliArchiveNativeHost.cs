using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace BilibiliArchiveHelper
{
    internal static class Program
    {
        private const int MaxMessageBytes = 64 * 1024 * 1024;
        private const string HelperVersion = "0.5.2";
        private static bool SelfTestMode;
        private static readonly Stream Input = Console.OpenStandardInput();
        private static readonly Stream Output = Console.OpenStandardOutput();
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = MaxMessageBytes };
        private static readonly object OutputLock = new object();
        private static string SessionRoot;
        private static Dictionary<string, object> SessionMerge;
        private static FileStream CurrentFile;
        private static string CurrentFinalPath;
        private static string CurrentTemporaryPath;

        private static string L(string english, string chinese)
        {
            return String.Equals(CultureInfo.CurrentUICulture.TwoLetterISOLanguageName, "zh", StringComparison.OrdinalIgnoreCase)
                ? chinese
                : english;
        }

        [STAThread]
        private static int Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            try
            {
                if (args.Length == 4 && args[0] == "--self-test-merge")
                {
                    SelfTestMode = true;
                    string ffmpeg = FindExecutable("ffmpeg.exe");
                    if (String.IsNullOrEmpty(ffmpeg)) throw new FileNotFoundException("ffmpeg.exe was not found");
                    MergeAndVerify(ffmpeg, Path.GetFullPath(args[1]), Path.GetFullPath(args[2]), Path.GetFullPath(args[3]));
                    Console.Error.WriteLine("Merge self-test passed: " + args[3]);
                    return 0;
                }
                if (args.Length == 4 && args[0] == "--self-test-stream")
                {
                    SelfTestMode = true;
                    StreamSelfTest(Path.GetFullPath(args[1]), Path.GetFullPath(args[2]), Path.GetFullPath(args[3]));
                    Console.Error.WriteLine("Streaming self-test passed: " + args[3]);
                    return 0;
                }
                while (true)
                {
                    Dictionary<string, object> message = ReadMessage();
                    if (message == null)
                    {
                        CleanupSession();
                        return 0;
                    }
                    HandleMessage(message);
                }
            }
            catch (Exception error)
            {
                CleanupSession();
                if (SelfTestMode) Console.Error.WriteLine(error.ToString());
                else TryWrite(new Dictionary<string, object>
                {
                    { "type", "error" },
                    { "message", error.Message }
                });
                WriteDiagnostic(error.ToString());
                return 1;
            }
        }

        private static void HandleMessage(Dictionary<string, object> message)
        {
            string action = GetString(message, "action");
            if (action == "ping")
            {
                string ffmpeg = FindExecutable("ffmpeg.exe");
                WriteMessage(new Dictionary<string, object>
                {
                    { "type", "ready" },
                    { "ok", !String.IsNullOrEmpty(ffmpeg) },
                    { "helperVersion", HelperVersion },
                    { "ffmpegPath", ffmpeg ?? "" },
                    { "ffmpegVersion", String.IsNullOrEmpty(ffmpeg) ? "" : FirstVersionLine(ffmpeg) },
                    { "message", String.IsNullOrEmpty(ffmpeg) ? L("FFmpeg was not found. Rerun the local-helper installer and follow its automatic or manual installation guidance.", "未找到 FFmpeg。请重新运行本地助手安装脚本，并按提示一键安装或手动安装。") : L("The local helper is ready", "本地助手已就绪") }
                });
                return;
            }

            if (action == "startJob")
            {
                StartSession(GetDictionary(message, "merge"));
                return;
            }
            if (String.IsNullOrEmpty(SessionRoot)) throw new InvalidOperationException(L("Start a save job first", "请先启动保存任务"));
            if (action == "writeText")
            {
                WriteTextAtomic(ResolveUnderRoot(SessionRoot, GetString(message, "filename")), GetString(message, "content"));
                WriteAck();
                return;
            }
            if (action == "startFile")
            {
                StartFile(GetString(message, "filename"));
                WriteAck();
                return;
            }
            if (action == "writeChunk")
            {
                WriteChunk(GetString(message, "data"));
                WriteAck();
                return;
            }
            if (action == "finishFile")
            {
                FinishFile();
                WriteAck();
                return;
            }
            if (action == "abortFile")
            {
                AbortFile();
                WriteAck();
                return;
            }
            if (action == "merge")
            {
                CompleteMerge();
                return;
            }
            throw new InvalidOperationException(L("Unsupported action: ", "不支持的操作：") + action);
        }

        private static void StartSession(Dictionary<string, object> merge)
        {
            if (merge == null) throw new InvalidOperationException(L("The job is missing merge information", "任务缺少合并信息"));
            if (String.IsNullOrEmpty(FindExecutable("ffmpeg.exe")))
                throw new FileNotFoundException(L("FFmpeg was not found. Rerun the local-helper installer and follow its installation guidance.", "未找到 FFmpeg。请重新运行本地助手安装脚本，并按提示安装。"));
            CleanupSession();
            using (FolderBrowserDialog dialog = new FolderBrowserDialog())
            {
                dialog.Description = L("Choose the Bilibili destination folder (network requests remain in Chrome)", "选择 Bilibili 文件保存目录（网络请求仍由 Chrome 发起）");
                dialog.ShowNewFolderButton = true;
                if (dialog.ShowDialog() != DialogResult.OK || String.IsNullOrWhiteSpace(dialog.SelectedPath))
                {
                    WriteMessage(new Dictionary<string, object> { { "type", "cancelled" } });
                    return;
                }
                SessionRoot = Path.GetFullPath(dialog.SelectedPath);
            }
            SessionMerge = merge;
            WriteMessage(new Dictionary<string, object> { { "type", "selected" }, { "path", SessionRoot } });
        }

        private static void StartFile(string relative)
        {
            if (CurrentFile != null) throw new InvalidOperationException(L("The previous file is still open", "上一个文件尚未完成"));
            CurrentFinalPath = ResolveUnderRoot(SessionRoot, relative);
            CurrentTemporaryPath = CurrentFinalPath + ".part";
            EnsureDirectory(CurrentFinalPath);
            DeleteFile(CurrentTemporaryPath);
            CurrentFile = new FileStream(LongPath(CurrentTemporaryPath), FileMode.Create, FileAccess.Write, FileShare.None, 1024 * 1024, FileOptions.SequentialScan);
        }

        private static void WriteChunk(string encoded)
        {
            if (CurrentFile == null) throw new InvalidOperationException(L("No media file is open", "当前没有打开的媒体文件"));
            if (String.IsNullOrEmpty(encoded)) throw new InvalidOperationException(L("The media chunk is empty", "媒体分块为空"));
            byte[] data = Convert.FromBase64String(encoded);
            CurrentFile.Write(data, 0, data.Length);
        }

        private static void FinishFile()
        {
            if (CurrentFile == null) throw new InvalidOperationException(L("No media file is open", "当前没有打开的媒体文件"));
            CurrentFile.Flush(true);
            CurrentFile.Dispose();
            CurrentFile = null;
            ReplaceFile(CurrentTemporaryPath, CurrentFinalPath);
            CurrentTemporaryPath = null;
            CurrentFinalPath = null;
        }

        private static void AbortFile()
        {
            if (CurrentFile != null)
            {
                CurrentFile.Dispose();
                CurrentFile = null;
            }
            if (!String.IsNullOrEmpty(CurrentTemporaryPath)) DeleteFile(CurrentTemporaryPath);
            CurrentTemporaryPath = null;
            CurrentFinalPath = null;
        }

        private static void CompleteMerge()
        {
            if (CurrentFile != null) throw new InvalidOperationException(L("A media file is still being written; merging cannot start", "媒体文件仍在写入，不能开始合并"));
            string ffmpeg = FindExecutable("ffmpeg.exe");
            if (String.IsNullOrEmpty(ffmpeg)) throw new FileNotFoundException(L("FFmpeg was not found. Rerun the local-helper installer and follow its installation guidance.", "未找到 FFmpeg。请重新运行本地助手安装脚本，并按提示安装。"));
            string videoPath = ResolveUnderRoot(SessionRoot, GetString(SessionMerge, "videoFilename"));
            string audioPath = ResolveUnderRoot(SessionRoot, GetString(SessionMerge, "audioFilename"));
            string outputPath = ResolveUnderRoot(SessionRoot, GetString(SessionMerge, "outputFilename"));
            MergeAndVerify(ffmpeg, videoPath, audioPath, outputPath);
            bool keepSources = !SessionMerge.ContainsKey("keepSources") || GetBool(SessionMerge, "keepSources");
            if (!keepSources)
            {
                DeleteFile(videoPath);
                DeleteFile(audioPath);
            }
            string outputFilename = GetString(SessionMerge, "outputFilename");
            SessionRoot = null;
            SessionMerge = null;
            WriteMessage(new Dictionary<string, object>
            {
                { "type", "completed" },
                { "outputFilename", outputFilename },
                { "keptSources", keepSources }
            });
        }

        private static void CleanupSession()
        {
            AbortFile();
            SessionRoot = null;
            SessionMerge = null;
        }

        private static void WriteAck()
        {
            WriteMessage(new Dictionary<string, object> { { "type", "ack" } });
        }

        private static void StreamSelfTest(string sourceVideo, string sourceAudio, string root)
        {
            Directory.CreateDirectory(LongPath(root));
            SessionRoot = root;
            SessionMerge = new Dictionary<string, object>
            {
                { "videoFilename", "video.m4s" },
                { "audioFilename", "audio.m4s" },
                { "outputFilename", "merged.mp4" },
                { "keepSources", false }
            };
            CopyThroughChunkWriter(sourceVideo, "video.m4s");
            CopyThroughChunkWriter(sourceAudio, "audio.m4s");
            string video = ResolveUnderRoot(root, "video.m4s");
            string audio = ResolveUnderRoot(root, "audio.m4s");
            string output = ResolveUnderRoot(root, "merged.mp4");
            MergeAndVerify(FindExecutable("ffmpeg.exe"), video, audio, output);
            DeleteFile(video);
            DeleteFile(audio);
            if (!FileExists(output) || FileExists(video) || FileExists(audio))
                throw new InvalidOperationException("Streaming self-test did not leave exactly one merged MP4");
            SessionRoot = null;
            SessionMerge = null;
        }

        private static void CopyThroughChunkWriter(string source, string relative)
        {
            StartFile(relative);
            try
            {
                using (FileStream input = new FileStream(LongPath(source), FileMode.Open, FileAccess.Read, FileShare.Read))
                {
                    byte[] buffer = new byte[256 * 1024];
                    int read;
                    while ((read = input.Read(buffer, 0, buffer.Length)) > 0)
                    {
                        byte[] chunk = read == buffer.Length ? buffer : buffer.Take(read).ToArray();
                        WriteChunk(Convert.ToBase64String(chunk));
                    }
                }
                FinishFile();
            }
            catch
            {
                AbortFile();
                throw;
            }
        }

        private static void WriteTextAtomic(string destination, string content)
        {
            EnsureDirectory(destination);
            string temporary = destination + ".part";
            DeleteFile(temporary);
            using (StreamWriter writer = new StreamWriter(LongPath(temporary), false, new UTF8Encoding(false))) writer.Write(content ?? "");
            ReplaceFile(temporary, destination);
        }

        private static void MergeAndVerify(string ffmpeg, string videoPath, string audioPath, string outputPath)
        {
            bool videoExists = FileExists(videoPath);
            bool audioExists = FileExists(audioPath);
            if (!videoExists || !audioExists)
                throw new FileNotFoundException(String.Format(L("The video or audio stream is missing (video={0}: {1}; audio={2}: {3})", "视频流或音频流不存在，无法合并（video={0}: {1}; audio={2}: {3}）"), videoExists, videoPath, audioExists, audioPath));
            EnsureDirectory(outputPath);
            string temporaryOutput = outputPath + ".merging.mp4";
            DeleteFile(temporaryOutput);
            string normalizedVideo = NormalizeM4s(videoPath);
            string normalizedAudio = NormalizeM4s(audioPath);
            try
            {
                string arguments = "-hide_banner -nostdin -loglevel error -y -i " + Quote(LongPath(normalizedVideo)) +
                    " -i " + Quote(LongPath(normalizedAudio)) +
                    " -map 0:v:0 -map 1:a:0 -c copy -movflags +faststart -f mp4 " + Quote(LongPath(temporaryOutput));
                string error = RunProcess(ffmpeg, arguments);
                if (!FileExists(temporaryOutput) || FileLength(temporaryOutput) <= 0)
                    throw new InvalidOperationException(L("FFmpeg did not create a valid MP4", "FFmpeg 未生成有效 MP4") + (String.IsNullOrWhiteSpace(error) ? "" : ": " + error.Trim()));
                string ffprobe = FindSiblingOrExecutable(ffmpeg, "ffprobe.exe");
                if (!String.IsNullOrEmpty(ffprobe))
                {
                    string probe = RunProcess(ffprobe, "-v error -show_entries stream=codec_type -of default=noprint_wrappers=1 " + Quote(LongPath(temporaryOutput)), true);
                    if (probe.IndexOf("codec_type=video", StringComparison.OrdinalIgnoreCase) < 0 ||
                        probe.IndexOf("codec_type=audio", StringComparison.OrdinalIgnoreCase) < 0)
                        throw new InvalidOperationException(L("Merge validation failed: the output does not contain both video and audio streams", "合并校验失败：输出文件没有同时包含视频流和音频流"));
                }
                ReplaceFile(temporaryOutput, outputPath);
            }
            finally
            {
                DeleteFile(temporaryOutput);
                if (!String.Equals(normalizedVideo, videoPath, StringComparison.OrdinalIgnoreCase)) DeleteFile(normalizedVideo);
                if (!String.Equals(normalizedAudio, audioPath, StringComparison.OrdinalIgnoreCase)) DeleteFile(normalizedAudio);
            }
        }

        private static string NormalizeM4s(string source)
        {
            using (FileStream input = new FileStream(LongPath(source), FileMode.Open, FileAccess.Read, FileShare.Read, 1024 * 1024, FileOptions.SequentialScan))
            {
                byte[] header = new byte[9];
                int read = input.Read(header, 0, header.Length);
                bool prefixed = read == 9 && header.All(delegate(byte value) { return value == 0x30; });
                if (!prefixed) return source;
                string normalized = source + ".normalized.m4s";
                DeleteFile(normalized);
                using (FileStream output = new FileStream(LongPath(normalized), FileMode.Create, FileAccess.Write, FileShare.None, 1024 * 1024, FileOptions.SequentialScan))
                {
                    input.CopyTo(output, 1024 * 1024);
                    output.Flush(true);
                }
                return normalized;
            }
        }

        private static string RunProcess(string executable, string arguments, bool returnStandardOutput = false)
        {
            ProcessStartInfo start = new ProcessStartInfo(executable, arguments)
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardError = true,
                RedirectStandardOutput = true,
                StandardErrorEncoding = Encoding.UTF8
            };
            start.StandardOutputEncoding = Encoding.UTF8;
            using (Process process = Process.Start(start))
            {
                string standardOutput = process.StandardOutput.ReadToEnd();
                string standardError = process.StandardError.ReadToEnd();
                process.WaitForExit();
                if (process.ExitCode != 0) throw new InvalidOperationException(InnermostMessage(new Exception(standardError.Trim())));
                return returnStandardOutput ? standardOutput : standardError;
            }
        }

        private static string ResolveUnderRoot(string root, string relative)
        {
            if (String.IsNullOrWhiteSpace(relative)) throw new InvalidOperationException(L("The filename is empty", "文件名为空"));
            string normalized = relative.Replace('/', Path.DirectorySeparatorChar).Replace('\\', Path.DirectorySeparatorChar);
            if (Path.IsPathRooted(normalized)) throw new InvalidOperationException(L("Absolute paths are not allowed: ", "不允许绝对路径：") + relative);
            string rootFull = Path.GetFullPath(root);
            string full = Path.GetFullPath(Path.Combine(rootFull, normalized));
            string rootPrefix = rootFull.EndsWith(Path.DirectorySeparatorChar.ToString(), StringComparison.Ordinal)
                ? rootFull
                : rootFull + Path.DirectorySeparatorChar;
            if (!full.StartsWith(rootPrefix, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException(L("The path escapes the selected folder: ", "文件路径超出所选目录：") + relative);
            return full;
        }

        private static void EnsureDirectory(string path)
        {
            string directory = Path.GetDirectoryName(path);
            if (!String.IsNullOrEmpty(directory)) Directory.CreateDirectory(LongPath(directory));
        }

        private static string LongPath(string path)
        {
            string full = Path.GetFullPath(path);
            if (full.StartsWith(@"\\?\", StringComparison.Ordinal)) return full;
            if (full.Length < 248) return full;
            if (full.StartsWith(@"\\", StringComparison.Ordinal)) return @"\\?\UNC\" + full.Substring(2);
            return @"\\?\" + full;
        }

        private static bool FileExists(string path) { return File.Exists(LongPath(path)); }
        private static long FileLength(string path) { return new FileInfo(LongPath(path)).Length; }
        private static void DeleteFile(string path) { if (FileExists(path)) File.Delete(LongPath(path)); }
        private static void ReplaceFile(string source, string destination)
        {
            DeleteFile(destination);
            File.Move(LongPath(source), LongPath(destination));
        }

        private static string FindExecutable(string name)
        {
            string path = Environment.GetEnvironmentVariable("PATH") ?? "";
            foreach (string part in path.Split(Path.PathSeparator))
            {
                try
                {
                    string candidate = Path.Combine(part.Trim().Trim('"'), name);
                    if (File.Exists(candidate)) return candidate;
                }
                catch { }
            }
            string programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string fixedCandidate = Path.Combine(programFiles, "ffmpeg-9.0-full_build", "bin", name);
            if (File.Exists(fixedCandidate)) return fixedCandidate;
            try
            {
                foreach (string directory in Directory.GetDirectories(programFiles, "ffmpeg*"))
                {
                    string candidate = Path.Combine(directory, "bin", name);
                    if (File.Exists(candidate)) return candidate;
                }
            }
            catch { }
            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string wingetLink = Path.Combine(localAppData, "Microsoft", "WinGet", "Links", name);
            if (File.Exists(wingetLink)) return wingetLink;
            try
            {
                string packages = Path.Combine(localAppData, "Microsoft", "WinGet", "Packages");
                if (Directory.Exists(packages))
                {
                    foreach (string directory in Directory.GetDirectories(packages, "Gyan.FFmpeg*"))
                    {
                        string[] matches = Directory.GetFiles(directory, name, SearchOption.AllDirectories);
                        if (matches.Length > 0) return matches[0];
                    }
                }
            }
            catch { }
            return null;
        }

        private static string FindSiblingOrExecutable(string executable, string name)
        {
            string sibling = Path.Combine(Path.GetDirectoryName(executable), name);
            return File.Exists(sibling) ? sibling : FindExecutable(name);
        }

        private static string FirstVersionLine(string executable)
        {
            try
            {
                string output = RunProcess(executable, "-version", true);
                string first = output.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? "";
                string[] parts = first.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                return parts.Length >= 3 ? parts[2] : first;
            }
            catch { return L("found", "已找到"); }
        }

        private static string Quote(string value) { return "\"" + value.Replace("\"", "\\\"") + "\""; }
        private static string FormatBytes(long bytes)
        {
            string[] units = { "B", "KB", "MB", "GB" };
            double value = bytes;
            int index = 0;
            while (value >= 1024 && index < units.Length - 1) { value /= 1024; index++; }
            return value.ToString(index > 1 ? "0.0" : "0") + " " + units[index];
        }

        private static void Progress(int percent, string label, string message)
        {
            Dictionary<string, object> payload = new Dictionary<string, object>
            {
                { "type", "progress" },
                { "percent", Math.Max(0, Math.Min(100, percent)) },
                { "label", label ?? "" }
            };
            if (!String.IsNullOrEmpty(message)) payload["message"] = message;
            WriteMessage(payload);
        }

        private static Dictionary<string, object> ReadMessage()
        {
            byte[] lengthBytes = ReadExact(4);
            if (lengthBytes == null) return null;
            int length = BitConverter.ToInt32(lengthBytes, 0);
            if (length <= 0 || length > MaxMessageBytes) throw new InvalidDataException(L("Invalid Native Messaging message length: ", "Native Messaging 消息长度无效：") + length);
            byte[] body = ReadExact(length);
            if (body == null) throw new EndOfStreamException(L("The Native Messaging message was truncated", "Native Messaging 消息未完整接收"));
            return Json.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(body));
        }

        private static byte[] ReadExact(int count)
        {
            byte[] buffer = new byte[count];
            int offset = 0;
            while (offset < count)
            {
                int read = Input.Read(buffer, offset, count - offset);
                if (read <= 0) return offset == 0 ? null : buffer.Take(offset).ToArray();
                offset += read;
            }
            return buffer;
        }

        private static void WriteMessage(Dictionary<string, object> message)
        {
            byte[] body = Encoding.UTF8.GetBytes(Json.Serialize(message));
            byte[] length = BitConverter.GetBytes(body.Length);
            lock (OutputLock)
            {
                Output.Write(length, 0, length.Length);
                Output.Write(body, 0, body.Length);
                Output.Flush();
            }
        }

        private static void TryWrite(Dictionary<string, object> message) { try { WriteMessage(message); } catch { } }
        private static Dictionary<string, object> GetDictionary(Dictionary<string, object> source, string key)
        {
            object value;
            return source.TryGetValue(key, out value) ? value as Dictionary<string, object> : null;
        }
        private static string GetString(Dictionary<string, object> source, string key)
        {
            object value;
            return source != null && source.TryGetValue(key, out value) && value != null ? Convert.ToString(value) : "";
        }
        private static bool GetBool(Dictionary<string, object> source, string key)
        {
            object value;
            return source != null && source.TryGetValue(key, out value) && value != null && Convert.ToBoolean(value);
        }
        private static List<Dictionary<string, object>> GetDictionaryList(Dictionary<string, object> source, string key)
        {
            object value;
            List<Dictionary<string, object>> result = new List<Dictionary<string, object>>();
            if (!source.TryGetValue(key, out value) || value == null) return result;
            IEnumerable sequence = value as IEnumerable;
            if (sequence == null) return result;
            foreach (object item in sequence)
            {
                Dictionary<string, object> dictionary = item as Dictionary<string, object>;
                if (dictionary != null) result.Add(dictionary);
            }
            return result;
        }
        private static List<string> GetUrls(Dictionary<string, object> item)
        {
            List<string> urls = new List<string>();
            object value;
            if (item.TryGetValue("urls", out value) && value is IEnumerable)
            {
                foreach (object entry in (IEnumerable)value)
                {
                    string url = Convert.ToString(entry);
                    if (!String.IsNullOrWhiteSpace(url) && !urls.Contains(url)) urls.Add(url);
                }
            }
            string primary = GetString(item, "url");
            if (!String.IsNullOrWhiteSpace(primary) && !urls.Contains(primary)) urls.Add(primary);
            return urls;
        }
        private static string InnermostMessage(Exception error)
        {
            Exception current = error;
            while (current.InnerException != null) current = current.InnerException;
            return String.IsNullOrWhiteSpace(current.Message) ? current.GetType().Name : current.Message;
        }
        private static void WriteDiagnostic(string message)
        {
            try
            {
                string directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BilibiliArchiveHelper");
                Directory.CreateDirectory(directory);
                File.AppendAllText(Path.Combine(directory, "native-host.log"), DateTime.Now.ToString("s") + " " + message + Environment.NewLine, Encoding.UTF8);
            }
            catch { }
        }
    }
}
