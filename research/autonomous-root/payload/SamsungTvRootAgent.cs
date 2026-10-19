using System;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;

internal static partial class SamsungTvRootAgent
{
    private const string ProtocolVersion = "SAMSUNG-TV-ROOT/1";
    private const string AllowedStagingRoot =
        "/home/owner/share/tmp/sdk_tools/";
    private const string RuntimeRoot = "/run/samsung-tv-root";
    private const int ConnectTimeoutMilliseconds = 5000;
    private const int MaximumLineBytes = 4 * 1024 * 1024;
    private const int MaximumCommandBytes = 64 * 1024;
    private const int MaximumFileBytes = 4 * 1024 * 1024;
    private const int MaximumCommandOutputBytes = 1024 * 1024;
    private const int MaximumCommandTimeoutMilliseconds = 300000;
    private const int OpenReadWrite = 2;
    private const int SignalKill = 9;
    private static string statusPath;

    public static int Main(string[] arguments)
    {
        byte[] secret = null;
        string runtimeDirectory = null;
        try
        {
            if (arguments.Length != 4)
            {
                throw new ArgumentException(
                    "usage: SamsungTvRootAgent.dll CALLBACK_IPV4 PORT TOKEN_FILE STAGING_DIRECTORY");
            }
            string stagingDirectory = ValidateStagingDirectory(arguments[3]);
            statusPath = Path.Combine(stagingDirectory, "root-agent.status");
            WriteStatus("starting");
            runtimeDirectory = PrepareRuntimeDirectory();
            int port;
            if (!int.TryParse(arguments[1], out port)
                || port < 1
                || port > 65535)
            {
                throw new ArgumentException("invalid callback port");
            }

            string tokenPath = Path.GetFullPath(arguments[2]);
            if (!tokenPath.StartsWith(stagingDirectory, StringComparison.Ordinal))
            {
                throw new ArgumentException(
                    "root-agent token is outside the staging directory");
            }
            secret = ReadAndRemoveSecret(tokenPath);
            if (secret.Length < 32)
            {
                throw new InvalidDataException(
                    "root-agent secret must contain at least 32 bytes");
            }

            int session = setsid();
            if (session < 0 && getsid(0) != getpid())
            {
                throw new InvalidOperationException(
                    "setsid failed with errno " + Marshal.GetLastWin32Error());
            }
            DetachStandardStreams();
            PrepareAppLauncher();
            RunSession(
                arguments[0],
                port,
                secret,
                stagingDirectory,
                runtimeDirectory);
            WriteStatus("stopped");
            return 0;
        }
        catch (Exception exception)
        {
            WriteStatus(
                "failed "
                + exception.GetType().Name
                + ": "
                + exception.Message);
            return 1;
        }
        finally
        {
            StopJobs();
            CloseTransfers();
            CloseHelpers();
            CloseAppLauncher();
            DeleteRuntimeDirectory(runtimeDirectory);
            if (secret != null)
            {
                Zero(secret);
            }
        }
    }

    private static void ValidateUploadHeader(string[] fields, out long offset, out int length)
    {
        offset = 0; length = 0;
        if (fields.Length != 6 || fields[0] != "OPWRITE"
            || !System.Text.RegularExpressions.Regex.IsMatch(fields[2], "\\A[a-f0-9]{32}\\z")
            || !long.TryParse(fields[3], System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out offset)
            || offset < 0 || offset > TransferLimit
            || !int.TryParse(fields[4], System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out length)
            || length < 1 || length > ChunkBytes || length > TransferLimit - offset
            || fields[5].Length != 64 || !IsDigest(fields[5]))
            throw new InvalidDataException("Invalid binary upload header");
    }

    private static void RunSession(
        string host,
        int port,
        byte[] secret,
        string readableDirectory,
        string runtimeDirectory)
    {
        using (TcpClient client = new TcpClient())
        {
            Task connect = client.ConnectAsync(host, port);
            if (!connect.Wait(ConnectTimeoutMilliseconds))
            {
                throw new TimeoutException("root-agent callback timed out");
            }
            connect.GetAwaiter().GetResult();
            client.NoDelay = true;
            using (NetworkStream stream = client.GetStream())
            {
                var input = new ProtocolReader(stream);
                string hello = input.ReadLine();
                string[] helloFields = hello.Split('\t');
                if (helloFields.Length != 2
                    || helloFields[0] != ProtocolVersion)
                {
                    throw new InvalidDataException("invalid root-agent hello");
                }
                byte[] nonce = HexDecode(helloFields[1]);
                if (nonce.Length != 32)
                {
                    throw new InvalidDataException("invalid challenge length");
                }

                string authPayload = string.Join(
                    "\t",
                    "AUTH",
                    getpid().ToString(),
                    getuid().ToString(),
                    geteuid().ToString(),
                    getgid().ToString(),
                    getegid().ToString(),
                    ReadStatusValue("CapEff"),
                    Convert.ToBase64String(
                        Encoding.UTF8.GetBytes(ReadText("/proc/self/attr/current"))));
                WriteAuthenticated(stream, nonce, secret, authPayload);
                WriteStatus(
                    string.Format(
                        "connected pid={0} uid={1} gid={2}",
                        getpid(),
                        getuid(),
                        getgid()));

                long previousSequence = 0;
                while (true)
                {
                    string line = input.ReadLine();
                    string payload = VerifyAuthenticated(line, nonce, secret);
                    string[] fields = payload.Split('\t');
                    if (fields.Length < 2)
                    {
                        throw new InvalidDataException("invalid command frame");
                    }
                    long sequence;
                    if (!long.TryParse(fields[1], out sequence)
                        || sequence <= previousSequence)
                    {
                        throw new InvalidDataException(
                            "root-agent command sequence is not increasing");
                    }
                    previousSequence = sequence;

                    if (fields[0] == "OPWRITE")
                    {
                        // Framing failures terminate the channel. Consume a bounded body
                        // before reporting operation failures so the next frame stays aligned.
                        long offset; int length;
                        ValidateUploadHeader(fields, out offset, out length);
                        byte[] bytes = input.ReadExact(length);
                        object uploadResult = null; string failure = null;
                        try { uploadResult = WriteTransferChunk(fields[2], offset, bytes, fields[5]); }
                        catch (Exception error)
                        { failure = System.Text.Json.JsonSerializer.Serialize(new { ok = false, error = error.Message, outcome = "failed" }); }
                        if (failure == null) WriteOperationSuccess(stream, nonce, secret, fields[1], uploadResult);
                        else WriteAuthenticated(stream, nonce, secret, "OPRESULT\t" + fields[1] + "\t" + Convert.ToBase64String(Encoding.UTF8.GetBytes(failure)));
                        continue;
                    }

                    if (fields[0] == "OP" && fields.Length == 3)
                    {
                        object operationResult = null;
                        string response = null;
                        try
                        {
                            using (var document = System.Text.Json.JsonDocument.Parse(Convert.FromBase64String(fields[2])))
                                operationResult = Operation(document.RootElement, readableDirectory, runtimeDirectory);
                        }
                        catch (Exception error)
                        {
                            response = System.Text.Json.JsonSerializer.Serialize(new { ok = false, error = error.Message, outcome = "failed" });
                        }
                        if (response == null)
                            WriteOperationSuccess(stream, nonce, secret, fields[1], operationResult);
                        else
                            WriteAuthenticated(stream, nonce, secret, "OPRESULT\t" + fields[1] + "\t" + Convert.ToBase64String(Encoding.UTF8.GetBytes(response)));
                        continue;
                    }

                    if (fields[0] == "PING" && fields.Length == 2)
                    {
                        WriteAuthenticated(
                            stream,
                            nonce,
                            secret,
                            string.Join(
                                "\t",
                                "PONG",
                                fields[1],
                                getuid().ToString(),
                                geteuid().ToString(),
                                getgid().ToString(),
                                getegid().ToString()));
                        continue;
                    }
                    if (fields[0] == "SHUTDOWN" && fields.Length == 2)
                    {
                        WriteAuthenticated(
                            stream,
                            nonce,
                            secret,
                            "BYE\t" + fields[1]);
                        return;
                    }
                    if (fields[0] == "READFILE" && fields.Length == 3)
                    {
                        byte[] pathBytes = Convert.FromBase64String(fields[2]);
                        if (pathBytes.Length == 0 || pathBytes.Length > 4096)
                        {
                            throw new InvalidDataException(
                                "invalid READFILE path length");
                        }
                        string path = Path.GetFullPath(
                            Encoding.UTF8.GetString(pathBytes));
                        if (!IsAllowedFilePath(
                                path,
                                readableDirectory,
                                runtimeDirectory))
                        {
                            throw new InvalidDataException(
                                "READFILE path is outside the allowed directories");
                        }
                        FileInfo file = new FileInfo(path);
                        if (!file.Exists
                            || file.Length < 0
                            || file.Length > MaximumFileBytes)
                        {
                            throw new InvalidDataException(
                                "READFILE payload is missing or too large");
                        }
                        byte[] data = File.ReadAllBytes(path);
                        string digest;
                        using (SHA256 sha256 = SHA256.Create())
                        {
                            digest = HexEncode(sha256.ComputeHash(data));
                        }
                        WriteAuthenticated(
                            stream,
                            nonce,
                            secret,
                            string.Join(
                                "\t",
                                "FILE",
                                fields[1],
                                data.Length.ToString(),
                                digest));
                        stream.Write(data, 0, data.Length);
                        stream.Flush();
                        continue;
                    }
                    if (fields[0] == "WRITEFILE" && fields.Length == 5)
                    {
                        byte[] pathBytes = Convert.FromBase64String(fields[2]);
                        int length;
                        if (pathBytes.Length == 0
                            || pathBytes.Length > 4096
                            || !int.TryParse(fields[3], out length)
                            || length < 0
                            || length > MaximumFileBytes)
                        {
                            throw new InvalidDataException(
                                "invalid WRITEFILE metadata");
                        }
                        string path = Path.GetFullPath(
                            Encoding.UTF8.GetString(pathBytes));
                        if (!IsAllowedFilePath(
                                path,
                                readableDirectory,
                                runtimeDirectory))
                        {
                            throw new InvalidDataException(
                                "WRITEFILE path is outside the allowed directories");
                        }
                        byte[] data = input.ReadExact(length);
                        string digest;
                        using (SHA256 sha256 = SHA256.Create())
                        {
                            digest = HexEncode(sha256.ComputeHash(data));
                        }
                        if (!string.Equals(
                                digest,
                                fields[4],
                                StringComparison.OrdinalIgnoreCase))
                        {
                            throw new InvalidDataException(
                                "WRITEFILE payload digest mismatch");
                        }
                        using (FileStream file = new FileStream(
                            path,
                            FileMode.CreateNew,
                            FileAccess.Write,
                            FileShare.None))
                        {
                            file.Write(data, 0, data.Length);
                            file.Flush();
                        }
                        if (chmod(path, 384) != 0)
                        {
                            File.Delete(path);
                            throw new IOException(
                                "WRITEFILE chmod failed with errno "
                                + Marshal.GetLastWin32Error());
                        }
                        WriteAuthenticated(
                            stream,
                            nonce,
                            secret,
                            string.Join(
                                "\t",
                                "WROTE",
                                fields[1],
                                length.ToString(),
                                digest));
                        continue;
                    }
                    if (fields[0] != "EXEC" || fields.Length != 4)
                    {
                        throw new InvalidDataException("unsupported command frame");
                    }

                    int timeout;
                    if (!int.TryParse(fields[2], out timeout)
                        || timeout < 100
                        || timeout > MaximumCommandTimeoutMilliseconds)
                    {
                        throw new InvalidDataException("invalid command timeout");
                    }
                    byte[] commandBytes = Convert.FromBase64String(fields[3]);
                    if (commandBytes.Length == 0
                        || commandBytes.Length > MaximumCommandBytes)
                    {
                        throw new InvalidDataException("invalid command length");
                    }
                    string command = Encoding.UTF8.GetString(commandBytes);
                    CommandResult result = Execute(command, timeout);
                    WriteAuthenticated(
                        stream,
                        nonce,
                        secret,
                        string.Join(
                            "\t",
                            "RESULT",
                            fields[1],
                            result.ExitCode.ToString(),
                            result.TimedOut ? "1" : "0",
                            Convert.ToBase64String(result.StandardOutput),
                            Convert.ToBase64String(result.StandardError)));
                }
            }
        }
    }

    private static CommandResult Execute(string command, int timeout)
    {
        ProcessStartInfo start = new ProcessStartInfo();
        start.FileName = "/usr/bin/setsid";
        start.ArgumentList.Add("/bin/sh");
        start.ArgumentList.Add("-c");
        start.ArgumentList.Add(command);
        start.UseShellExecute = false;
        start.CreateNoWindow = true;
        start.RedirectStandardOutput = true;
        start.RedirectStandardError = true;

        using (Process process = Process.Start(start))
        {
            if (process == null)
            {
                throw new InvalidOperationException("failed to start /bin/sh");
            }
            Task<CapturedOutput> output = CaptureOutput(
                process.StandardOutput.BaseStream);
            Task<CapturedOutput> error = CaptureOutput(
                process.StandardError.BaseStream);
            bool exited = process.WaitForExit(timeout);
            // The shell can exit while a background child still owns its pipes.
            // EXEC is bounded work; persistent work belongs in the job API.
            int signalResult = kill(-process.Id, SignalKill);
            if (!exited)
            {
                if (signalResult < 0)
                {
                    try { process.Kill(); } catch (InvalidOperationException) { }
                }
                if (!process.WaitForExit(1000))
                    throw new IOException("Command did not exit after termination");
            }
            if (!Task.WaitAll(new Task[] { output, error }, 1000))
            {
                // A child may have escaped the group with setsid. Do not wait
                // forever or report a successful result with incomplete output.
                process.StandardOutput.Close();
                process.StandardError.Close();
                throw new IOException("Command output drain timed out");
            }
            byte[] standardError = error.Result.Data;
            if (output.Result.Truncated || error.Result.Truncated)
            {
                standardError = AppendOutputLimitNotice(
                    standardError,
                    output.Result.Truncated,
                    error.Result.Truncated);
            }
            return new CommandResult(
                exited ? process.ExitCode : 124,
                !exited,
                output.Result.Data,
                standardError);
        }
    }

    private static async Task<CapturedOutput> CaptureOutput(Stream stream)
    {
        byte[] chunk = new byte[8192];
        bool truncated = false;
        using (MemoryStream retained = new MemoryStream())
        {
            while (true)
            {
                int count = await stream.ReadAsync(chunk, 0, chunk.Length);
                if (count == 0)
                {
                    break;
                }
                int remaining = MaximumCommandOutputBytes - (int)retained.Length;
                if (remaining > 0)
                {
                    retained.Write(chunk, 0, Math.Min(count, remaining));
                }
                if (count > remaining)
                {
                    truncated = true;
                }
            }
            return new CapturedOutput(retained.ToArray(), truncated);
        }
    }

    private static byte[] AppendOutputLimitNotice(
        byte[] standardError,
        bool standardOutputTruncated,
        bool standardErrorTruncated)
    {
        string streams = standardOutputTruncated && standardErrorTruncated
            ? "stdout and stderr"
            : standardOutputTruncated ? "stdout" : "stderr";
        byte[] notice = Encoding.UTF8.GetBytes(
            "\n[samsung-tv-root: " + streams + " exceeded the 1 MiB capture limit]\n");
        byte[] result = new byte[standardError.Length + notice.Length];
        Buffer.BlockCopy(standardError, 0, result, 0, standardError.Length);
        Buffer.BlockCopy(notice, 0, result, standardError.Length, notice.Length);
        return result;
    }

    private static void WriteOperationSuccess(Stream stream, byte[] nonce, byte[] secret, string sequence, object result)
    {
        var chunk = result as FileChunk;
        if (chunk != null)
        {
            // The authenticated header binds sequence, range, length and digest.
            // A partial write is a transport failure; never append a JSON result.
            WriteAuthenticated(stream, nonce, secret, string.Join("\t", "OPDATA", sequence,
                chunk.offset.ToString(System.Globalization.CultureInfo.InvariantCulture),
                chunk.data.Length.ToString(System.Globalization.CultureInfo.InvariantCulture), chunk.sha256));
            stream.Write(chunk.data, 0, chunk.data.Length);
            stream.Flush();
            return;
        }
        string response = System.Text.Json.JsonSerializer.Serialize(new { ok = true, result });
        WriteAuthenticated(stream, nonce, secret, "OPRESULT\t" + sequence + "\t" + Convert.ToBase64String(Encoding.UTF8.GetBytes(response)));
    }

    private static void WriteAuthenticated(
        Stream stream,
        byte[] nonce,
        byte[] secret,
        string payload)
    {
        string line = payload + "\t" + Authenticate(nonce, secret, payload);
        byte[] bytes = Encoding.UTF8.GetBytes(line + "\n");
        stream.Write(bytes, 0, bytes.Length);
        stream.Flush();
    }

    private static string VerifyAuthenticated(
        string line,
        byte[] nonce,
        byte[] secret)
    {
        int separator = line.LastIndexOf('\t');
        if (separator < 1)
        {
            throw new InvalidDataException("missing frame authenticator");
        }
        string payload = line.Substring(0, separator);
        byte[] observed = HexDecode(line.Substring(separator + 1));
        byte[] expected = HexDecode(Authenticate(nonce, secret, payload));
        if (observed.Length != expected.Length
            || !FixedTimeEquals(observed, expected))
        {
            throw new InvalidDataException("invalid frame authenticator");
        }
        return payload;
    }

    private static string Authenticate(
        byte[] nonce,
        byte[] secret,
        string payload)
    {
        byte[] payloadBytes = Encoding.UTF8.GetBytes(payload);
        byte[] message = new byte[nonce.Length + 1 + payloadBytes.Length];
        Buffer.BlockCopy(nonce, 0, message, 0, nonce.Length);
        Buffer.BlockCopy(payloadBytes, 0, message, nonce.Length + 1, payloadBytes.Length);
        using (HMACSHA256 hmac = new HMACSHA256(secret))
        {
            return HexEncode(hmac.ComputeHash(message));
        }
    }

    // One reader per connection: line parsing and legacy binary payloads must
    // consume the same read-ahead buffer. Writes use the original duplex stream.
    private sealed class ProtocolReader
    {
        private readonly Stream stream;
        private readonly byte[] bytes = new byte[64 * 1024];
        private int offset;
        private int end;

        public ProtocolReader(Stream stream) { this.stream = stream; }

        private bool Fill()
        {
            if (offset < end) return true;
            offset = 0;
            end = stream.Read(bytes, 0, bytes.Length);
            return end > 0;
        }

        public string ReadLine()
        {
            using (var line = new MemoryStream())
            {
                while (Fill())
                {
                    int newline = Array.IndexOf(bytes, (byte)'\n', offset, end - offset);
                    int count = (newline < 0 ? end : newline) - offset;
                    if (count > MaximumLineBytes - line.Length)
                        throw new InvalidDataException("root-agent frame exceeds size limit");
                    line.Write(bytes, offset, count);
                    offset += count;
                    if (newline >= 0)
                    {
                        offset++;
                        return Encoding.UTF8.GetString(line.GetBuffer(), 0, (int)line.Length).TrimEnd('\r');
                    }
                }
            }
            throw new EndOfStreamException("root-agent peer disconnected");
        }

        public byte[] ReadExact(int length)
        {
            byte[] data = new byte[length];
            int copied = 0;
            while (copied < length)
            {
                if (!Fill())
                    throw new EndOfStreamException("root-agent payload was truncated");
                int count = Math.Min(length - copied, end - offset);
                Buffer.BlockCopy(bytes, offset, data, copied, count);
                offset += count;
                copied += count;
            }
            return data;
        }
    }

    private static byte[] ReadAndRemoveSecret(string path)
    {
        byte[] secret;
        try
        {
            secret = Convert.FromBase64String(File.ReadAllText(path).Trim());
        }
        finally
        {
            try
            {
                File.Delete(path);
            }
            catch
            {
            }
        }
        return secret;
    }

    private static void DetachStandardStreams()
    {
        int descriptor = open("/dev/null", OpenReadWrite);
        if (descriptor < 0)
        {
            throw new InvalidOperationException(
                "open /dev/null failed with errno "
                + Marshal.GetLastWin32Error());
        }
        try
        {
            for (int target = 0; target <= 2; target++)
            {
                if (dup2(descriptor, target) < 0)
                {
                    throw new InvalidOperationException(
                        "dup2 failed with errno "
                        + Marshal.GetLastWin32Error());
                }
            }
        }
        finally
        {
            if (descriptor > 2)
            {
                close(descriptor);
            }
        }
    }

    private static string ReadText(string path)
    {
        try
        {
            return File.ReadAllText(path).Trim();
        }
        catch (Exception exception)
        {
            return "unavailable:" + exception.GetType().Name;
        }
    }

    private static string ReadStatusValue(string key)
    {
        try
        {
            foreach (string line in File.ReadAllLines("/proc/self/status"))
            {
                if (line.StartsWith(key + ":", StringComparison.Ordinal))
                {
                    return line.Substring(key.Length + 1).Trim();
                }
            }
            return "missing";
        }
        catch (Exception exception)
        {
            return "unavailable:" + exception.GetType().Name;
        }
    }

    private static string HexEncode(byte[] bytes)
    {
        StringBuilder output = new StringBuilder(bytes.Length * 2);
        foreach (byte value in bytes)
        {
            output.Append(value.ToString("x2"));
        }
        return output.ToString();
    }

    private static byte[] HexDecode(string value)
    {
        if ((value.Length & 1) != 0)
        {
            throw new InvalidDataException("invalid hexadecimal length");
        }
        byte[] output = new byte[value.Length / 2];
        for (int index = 0; index < output.Length; index++)
        {
            output[index] = Convert.ToByte(value.Substring(index * 2, 2), 16);
        }
        return output;
    }

    private static bool FixedTimeEquals(byte[] first, byte[] second)
    {
        int difference = first.Length ^ second.Length;
        int length = Math.Min(first.Length, second.Length);
        for (int index = 0; index < length; index++)
        {
            difference |= first[index] ^ second[index];
        }
        return difference == 0;
    }

    private static void Zero(byte[] bytes)
    {
        for (int index = 0; index < bytes.Length; index++)
        {
            bytes[index] = 0;
        }
    }

    private static void WriteStatus(string value)
    {
        if (string.IsNullOrEmpty(statusPath))
        {
            return;
        }
        try
        {
            File.WriteAllText(
                statusPath,
                DateTime.UtcNow.ToString("o") + " " + value + Environment.NewLine);
        }
        catch
        {
        }
    }

    private static string ValidateStagingDirectory(string value)
    {
        string path = Path.GetFullPath(value);
        if (!path.EndsWith(Path.DirectorySeparatorChar.ToString()))
        {
            path += Path.DirectorySeparatorChar;
        }
        if (!path.StartsWith(AllowedStagingRoot, StringComparison.Ordinal))
        {
            throw new ArgumentException(
                "root-agent staging directory is outside the allowed root");
        }
        return path;
    }

    private static string PrepareRuntimeDirectory()
    {
        Directory.CreateDirectory(RuntimeRoot);
        if (chmod(RuntimeRoot, 448) != 0)
        {
            throw new IOException(
                "runtime root chmod failed with errno "
                + Marshal.GetLastWin32Error());
        }
        string path = Path.Combine(RuntimeRoot, "agent-" + getpid());
        if (Directory.Exists(path))
        {
            Directory.Delete(path, true);
        }
        Directory.CreateDirectory(path);
        if (chmod(path, 448) != 0)
        {
            Directory.Delete(path, true);
            throw new IOException(
                "runtime directory chmod failed with errno "
                + Marshal.GetLastWin32Error());
        }
        return path + Path.DirectorySeparatorChar;
    }

    private static bool IsAllowedFilePath(
        string path,
        string stagingDirectory,
        string runtimeDirectory)
    {
        return path.StartsWith(stagingDirectory, StringComparison.Ordinal)
            || path.StartsWith(runtimeDirectory, StringComparison.Ordinal);
    }

    private static void DeleteRuntimeDirectory(string path)
    {
        if (string.IsNullOrEmpty(path))
        {
            return;
        }
        try
        {
            Directory.Delete(path, true);
        }
        catch
        {
        }
    }

    private sealed class CommandResult
    {
        internal readonly int ExitCode;
        internal readonly bool TimedOut;
        internal readonly byte[] StandardOutput;
        internal readonly byte[] StandardError;

        internal CommandResult(
            int exitCode,
            bool timedOut,
            byte[] standardOutput,
            byte[] standardError)
        {
            ExitCode = exitCode;
            TimedOut = timedOut;
            StandardOutput = standardOutput;
            StandardError = standardError;
        }
    }

    private sealed class CapturedOutput
    {
        internal readonly byte[] Data;
        internal readonly bool Truncated;

        internal CapturedOutput(byte[] data, bool truncated)
        {
            Data = data;
            Truncated = truncated;
        }
    }

    [DllImport("libc", SetLastError = true)]
    private static extern int setsid();

    [DllImport("libc", SetLastError = true)]
    private static extern int getsid(int processId);

    [DllImport("libc", SetLastError = true)]
    private static extern int open(string path, int flags);

    [DllImport("libc", SetLastError = true)]
    private static extern int dup2(int oldDescriptor, int newDescriptor);

    [DllImport("libc", SetLastError = true)]
    private static extern int close(int descriptor);

    [DllImport("libc", SetLastError = true)]
    private static extern int chmod(string path, int mode);

    [DllImport("libc", SetLastError = true)]
    private static extern int kill(int processId, int signalNumber);

    [DllImport("libc")]
    private static extern int getpid();

    [DllImport("libc")]
    private static extern uint getuid();

    [DllImport("libc")]
    private static extern uint geteuid();

    [DllImport("libc")]
    private static extern uint getgid();

    [DllImport("libc")]
    private static extern uint getegid();
}
