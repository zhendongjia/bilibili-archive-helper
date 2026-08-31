using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace BilibiliArchiveHelper
{
    internal static class Program
    {
        private const int MaxMessageBytes = 64 * 1024 * 1024;
        private const string HelperVersion = "0.4.0";
        private static bool SelfTestMode;
        private static readonly Stream Input = Console.OpenStandardInput();
        private static readonly Stream Output = Console.OpenStandardOutput();
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = MaxMessageBytes };
        private static readonly object OutputLock = new object();

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
                while (true)
                {
                    Dictionary<string, object> message = ReadMessage();
                    if (message == null) return 0;
                    HandleMessage(message);
                }
            }
            catch (Exception error)
            {
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
                    { "message", String.IsNullOrEmpty(ffmpeg) ? "未找到 ffmpeg.exe" : "本地助手已就绪" }
                });
                return;
            }

            if (action != "saveAndMerge") throw new InvalidOperationException("不支持的操作：" + action);
            Dictionary<string, object> job = GetDictionary(message, "job");
            if (job == null) throw new InvalidOperationException("任务内容为空");
            SaveAndMerge(job);
        }

        private static void SaveAndMerge(Dictionary<string, object> job)
        {
            Dictionary<string, object> merge = GetDictionary(job, "merge");
            if (merge == null) throw new InvalidOperationException("任务缺少合并信息");
            string ffmpeg = FindExecutable("ffmpeg.exe");
            if (String.IsNullOrEmpty(ffmpeg)) throw new FileNotFoundException("未找到 ffmpeg.exe，请先安装 FFmpeg 或将其加入 PATH");

            string root;
            using (FolderBrowserDialog dialog = new FolderBrowserDialog())
            {
                dialog.Description = "选择 Bilibili 文件保存目录（助手会串行下载并自动合并 MP4）";
                dialog.ShowNewFolderButton = true;
                if (dialog.ShowDialog() != DialogResult.OK || String.IsNullOrWhiteSpace(dialog.SelectedPath))
                {
                    WriteMessage(new Dictionary<string, object> { { "type", "cancelled" } });
                    return;
                }
                root = Path.GetFullPath(dialog.SelectedPath);
            }

            WriteMessage(new Dictionary<string, object> { { "type", "selected" }, { "path", root } });
            List<Dictionary<string, object>> items = GetDictionaryList(job, "items");
            if (items.Count == 0) throw new InvalidOperationException("任务没有待保存文件");
            int workCount = items.Count + 1;

            using (HttpClient client = CreateHttpClient())
            {
                for (int index = 0; index < items.Count; index++)
                {
                    Dictionary<string, object> item = items[index];
                    string relative = GetString(item, "filename");
                    string destination = ResolveUnderRoot(root, relative);
                    int begin = (int)Math.Floor(index * 90.0 / workCount);
                    string kind = GetString(item, "kind");
                    Progress(begin, String.Format("{0}/{1} · {2}", index + 1, items.Count, relative), "保存：" + relative);
                    if (kind == "text")
                    {
                        WriteTextAtomic(destination, GetString(item, "content"));
                    }
                    else if (kind == "url")
                    {
                        DownloadAtomic(client, item, destination, delegate(long written, long total)
                        {
                            double fraction = total > 0 ? Math.Min(1.0, written / (double)total) : 0;
                            int percent = begin + (int)Math.Floor((90.0 / workCount) * fraction);
                            Progress(percent, String.Format("{0}/{1} · {2}", index + 1, items.Count, FormatBytes(written)), null);
                        });
                    }
                    else
                    {
                        throw new InvalidOperationException("不支持的文件类型：" + kind);
                    }
                }
            }

            string videoPath = ResolveUnderRoot(root, GetString(merge, "videoFilename"));
            string audioPath = ResolveUnderRoot(root, GetString(merge, "audioFilename"));
            string outputPath = ResolveUnderRoot(root, GetString(merge, "outputFilename"));
            Progress(92, "FFmpeg 无损封装", "开始自动合并视频流和音频流……");
            MergeAndVerify(ffmpeg, videoPath, audioPath, outputPath);

            bool keepSources = !merge.ContainsKey("keepSources") || GetBool(merge, "keepSources");
            if (!keepSources)
            {
                DeleteFile(videoPath);
                DeleteFile(audioPath);
            }
            Progress(100, "保存及合并完成", "FFmpeg 合并并校验成功");
            WriteMessage(new Dictionary<string, object>
            {
                { "type", "completed" },
                { "outputFilename", GetString(merge, "outputFilename") },
                { "keptSources", keepSources }
            });
        }

        private static HttpClient CreateHttpClient()
        {
            HttpClientHandler handler = new HttpClientHandler
            {
                UseProxy = false,
                UseCookies = false,
                AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate
            };
            HttpClient client = new HttpClient(handler) { Timeout = TimeSpan.FromHours(12) };
            client.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36");
            client.DefaultRequestHeaders.Referrer = new Uri("https://www.bilibili.com/");
            client.DefaultRequestHeaders.Accept.ParseAdd("application/octet-stream,*/*");
            client.DefaultRequestHeaders.TryAddWithoutValidation("Origin", "https://www.bilibili.com");
            return client;
        }

        private static void DownloadAtomic(HttpClient client, Dictionary<string, object> item, string destination, Action<long, long> onProgress)
        {
            List<string> urls = GetUrls(item);
            if (urls.Count == 0) throw new InvalidOperationException("媒体地址为空");
            List<string> errors = new List<string>();
            foreach (string url in urls)
            {
                string temporary = destination + ".part";
                try
                {
                    EnsureDirectory(destination);
                    DeleteFile(temporary);
                    using (HttpResponseMessage response = client.GetAsync(url, HttpCompletionOption.ResponseHeadersRead).Result)
                    {
                        if (!response.IsSuccessStatusCode) throw new InvalidOperationException("HTTP " + (int)response.StatusCode);
                        string contentType = response.Content.Headers.ContentType == null ? "" : response.Content.Headers.ContentType.MediaType;
                        if (contentType.StartsWith("text/", StringComparison.OrdinalIgnoreCase) ||
                            contentType.IndexOf("json", StringComparison.OrdinalIgnoreCase) >= 0 ||
                            contentType.IndexOf("xml", StringComparison.OrdinalIgnoreCase) >= 0)
                        {
                            throw new InvalidOperationException("CDN 返回了非媒体内容：" + contentType);
                        }
                        long total = response.Content.Headers.ContentLength ?? 0;
                        using (Stream source = response.Content.ReadAsStreamAsync().Result)
                        using (FileStream target = new FileStream(LongPath(temporary), FileMode.Create, FileAccess.Write, FileShare.None, 1024 * 1024, FileOptions.SequentialScan))
                        {
                            byte[] buffer = new byte[1024 * 1024];
                            long written = 0;
                            int read;
                            Stopwatch report = Stopwatch.StartNew();
                            while ((read = source.Read(buffer, 0, buffer.Length)) > 0)
                            {
                                target.Write(buffer, 0, read);
                                written += read;
                                if (report.ElapsedMilliseconds >= 750)
                                {
                                    onProgress(written, total);
                                    report.Restart();
                                }
                            }
                            target.Flush(true);
                            onProgress(written, total);
                        }
                    }
                    ReplaceFile(temporary, destination);
                    return;
                }
                catch (Exception error)
                {
                    DeleteFile(temporary);
                    errors.Add(new Uri(url).Host + ": " + InnermostMessage(error));
                }
            }
            throw new InvalidOperationException("所有 CDN 节点均失败：" + String.Join("；", errors.ToArray()));
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
                throw new FileNotFoundException(String.Format("视频流或音频流不存在，无法合并（video={0}: {1}; audio={2}: {3}）", videoExists, videoPath, audioExists, audioPath));
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
                    throw new InvalidOperationException("FFmpeg 未生成有效 MP4" + (String.IsNullOrWhiteSpace(error) ? "" : "：" + error.Trim()));
                string ffprobe = FindSiblingOrExecutable(ffmpeg, "ffprobe.exe");
                if (!String.IsNullOrEmpty(ffprobe))
                {
                    string probe = RunProcess(ffprobe, "-v error -show_entries stream=codec_type -of default=noprint_wrappers=1 " + Quote(LongPath(temporaryOutput)), true);
                    if (probe.IndexOf("codec_type=video", StringComparison.OrdinalIgnoreCase) < 0 ||
                        probe.IndexOf("codec_type=audio", StringComparison.OrdinalIgnoreCase) < 0)
                        throw new InvalidOperationException("合并校验失败：输出文件没有同时包含视频流和音频流");
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
            if (String.IsNullOrWhiteSpace(relative)) throw new InvalidOperationException("文件名为空");
            string normalized = relative.Replace('/', Path.DirectorySeparatorChar).Replace('\\', Path.DirectorySeparatorChar);
            if (Path.IsPathRooted(normalized)) throw new InvalidOperationException("不允许绝对路径：" + relative);
            string rootFull = Path.GetFullPath(root);
            string full = Path.GetFullPath(Path.Combine(rootFull, normalized));
            string rootPrefix = rootFull.EndsWith(Path.DirectorySeparatorChar.ToString(), StringComparison.Ordinal)
                ? rootFull
                : rootFull + Path.DirectorySeparatorChar;
            if (!full.StartsWith(rootPrefix, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("文件路径超出所选目录：" + relative);
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
            catch { return "已找到"; }
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
            if (length <= 0 || length > MaxMessageBytes) throw new InvalidDataException("Native Messaging 消息长度无效：" + length);
            byte[] body = ReadExact(length);
            if (body == null) throw new EndOfStreamException("Native Messaging 消息未完整接收");
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
