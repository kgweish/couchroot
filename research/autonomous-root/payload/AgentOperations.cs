// Original Couchroot administrative operations (0BSD).
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;

internal static partial class SamsungTvRootAgent
{
    // Linux ARM32 and ARM64 assign O_NOFOLLOW differently from x86.
    private static int ReadOpenFlags(bool macOS, Architecture architecture)
    {
        if (macOS) return 0x104;
        int noFollow = architecture == Architecture.Arm || architecture == Architecture.Arm64 ? 0x8000 : 0x20000;
        // ARM32 still needs O_LARGEFILE for the allowed two-GiB boundary.
        int largeFile = architecture == Architecture.Arm ? 0x20000 : 0;
        return noFollow | largeFile | 0x800; // O_NONBLOCK
    }
    private static readonly string WorkerId = Guid.NewGuid().ToString("N");
    private const int ChunkBytes = 1024 * 1024;
    private const long TransferLimit = 2L * 1024 * 1024 * 1024;
    private sealed class FileChunk
    {
        public byte[] data { get; set; }
        public long offset { get; set; }
        public string sha256 { get; set; }
    }
    private sealed class Transfer : IDisposable
    {
        internal FileStream File;
        internal string Path, Temporary, Digest, Expected;
        internal long Size;
        internal bool Upload;
        public void Dispose() { File.Dispose(); if (Temporary != null) FileDelete(Temporary); }
    }
    private static readonly Dictionary<string, Transfer> Transfers = new Dictionary<string, Transfer>();
    private static void FileDelete(string path) { try { File.Delete(path); } catch { } }
    private static string Text(JsonElement value, string key) { return value.GetProperty(key).GetString(); }
    private static string Digest(Stream stream)
    {
        stream.Position = 0;
        using (var sha = SHA256.Create()) { string result = HexEncode(sha.ComputeHash(stream)); stream.Position = 0; return result; }
    }
    private static string DigestPath(string path)
    {
        using (var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read)) return Digest(file);
    }
    private static bool IsDigest(string value)
    {
        return value != null && System.Text.RegularExpressions.Regex.IsMatch(value, "^[a-f0-9]{64}$");
    }
    private static string CheckedPath(string path)
    {
        if (string.IsNullOrEmpty(path) || path.Length > 4096 || path.IndexOf('\0') >= 0 || !Path.IsPathRooted(path) || Path.GetFullPath(path) != path)
            throw new ArgumentException("Canonical absolute path required");
        // Refuse symlinks in all existing components, including a dangling leaf.
        string current = "/";
        foreach (string part in path.Substring(1).Split('/'))
        {
            if (part.Length == 0) throw new ArgumentException("Empty path component");
            current = Path.Combine(current, part);
            try { if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) throw new IOException("Symlinks are not supported"); }
            catch (FileNotFoundException) { }
        }
        return path;
    }
    private static string WritePath(string path, string staging, string runtime)
    {
        path = CheckedPath(path);
        if (!IsAllowedFilePath(path, staging, runtime) && !path.StartsWith(AllowedStagingRoot, StringComparison.Ordinal)
            && !path.StartsWith("/opt/couchroot-agent/files/", StringComparison.Ordinal))
            throw new ArgumentException("Upload target outside managed directories");
        return path;
    }
    // Operations are serialized by the wire reader. Job monitors mutate only
    // individual jobs, whose snapshots must be taken under their own locks.
    // This inventories this worker, not saved records or detached descendants.
    private static object ResourceInventory()
    {
        var transfers = new List<object>();
        foreach (var pair in Transfers)
            transfers.Add(new { id=pair.Key, direction=pair.Value.Upload ? "upload" : "download" });
        var jobs = new List<object>();
        foreach (var pair in Jobs)
            lock (pair.Value)
                jobs.Add(new { id=pair.Key, state=pair.Value.State, monitor_finished=pair.Value.Finished });
        return new { schema=1, scope="worker-owned", transfers, jobs, helpers=new List<string>(Helpers) };
    }
    private static object Operation(JsonElement value, string staging, string runtime)
    {
        string op = Text(value, "op");
        if (op == "status") return new { boot_id = BootId(), uptime_seconds = double.Parse(File.ReadAllText("/proc/uptime").Split(' ')[0], System.Globalization.CultureInfo.InvariantCulture), worker_id = WorkerId, processes = new { worker = new { pid = getpid(), start_ticks = ProcessIdentity(getpid()) }, guardian = (object)null }, resources = ResourceInventory(), app_launcher = new { implementation = "native", sha256 = AppLauncherDigest }, capabilities = new[] { "file-transfer-v1", "binary-download-v1", "binary-upload-v1", "jobs-v1", "app-profile-v1", "helper-view-v1", "native-app-launcher-v1", "resource-inventory-v1", "worker-process-identity-v1" } };
        if (op.StartsWith("helper.", StringComparison.Ordinal)) return HelperOperation(value);
        if (op.StartsWith("job.", StringComparison.Ordinal)) return JobOperation(value);
        if (op == "app.exec")
        {
            int timeout = value.GetProperty("timeout_ms").GetInt32();
            if (timeout < 100 || timeout > 25000) throw new ArgumentException("Invalid timeout");
            string command = Text(value, "command");
            if (command.Length == 0 || System.Text.Encoding.UTF8.GetByteCount(command) > 16384 || command.IndexOf('\0') >= 0) throw new ArgumentException("Invalid command");
            var result = Execute(AppCommand(command), timeout);
            return new { exit_code = result.ExitCode, timed_out = result.TimedOut, stdout = System.Text.Encoding.UTF8.GetString(result.StandardOutput), stderr = System.Text.Encoding.UTF8.GetString(result.StandardError) };
        }
        if (op == "file.open" || op == "file.begin")
        {
            if (Transfers.Count >= 8) throw new IOException("Transfer limit reached; close an existing transfer");
            string id = Guid.NewGuid().ToString("N");
            var t = new Transfer();
            t.Upload = op == "file.begin";
            if (t.Upload && Text(value, "path").StartsWith("/opt/couchroot-agent/files/", StringComparison.Ordinal))
            {
                JobDirectory(); ManagedDirectory("/opt/couchroot-agent/files", 448);
            }
            t.Path = t.Upload ? WritePath(Text(value, "path"), staging, runtime) : CheckedPath(Text(value, "path"));
            if (t.Upload)
            {
                t.Size = value.GetProperty("size").GetInt64(); t.Digest = Text(value, "sha256"); t.Expected = Text(value, "expected_sha256");
                if (t.Size < 0 || t.Size > TransferLimit || !IsDigest(t.Digest) || (t.Expected != "absent" && !IsDigest(t.Expected))) throw new ArgumentException("Invalid upload metadata");
                // Parent must already exist. No recursive creation of caller-selected paths.
                t.Temporary = t.Path + ".upload-" + id;
                t.File = new FileStream(t.Temporary, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None);
                if (chmod(t.Temporary, 384) != 0) { t.Dispose(); throw new IOException("Cannot protect upload"); }
            }
            else
            {
                if ((File.GetAttributes(t.Path) & FileAttributes.Directory) != 0 || t.Path.StartsWith("/proc/", StringComparison.Ordinal) || t.Path.StartsWith("/dev/", StringComparison.Ordinal) || t.Path.StartsWith("/sys/", StringComparison.Ordinal)) throw new IOException("Regular disk file required");
                int flags = ReadOpenFlags(RuntimeInformation.IsOSPlatform(OSPlatform.OSX), RuntimeInformation.ProcessArchitecture);
                int fd = open(t.Path, flags);
                if (fd < 0) throw new IOException("Cannot open regular file");
                var handle = new Microsoft.Win32.SafeHandles.SafeFileHandle((IntPtr)fd, true);
                try { t.File = new FileStream(handle, FileAccess.Read); if (!t.File.CanSeek) throw new IOException("Seekable regular file required"); }
                catch { handle.Dispose(); throw; }
                try { t.Size = t.File.Length; if (t.Size > TransferLimit) throw new IOException("File too large"); t.Digest = Digest(t.File); }
                catch { t.Dispose(); throw; }
            }
            Transfers.Add(id, t);
            return new { transfer_id = id, size = t.Size, sha256 = t.Digest, chunk_bytes = ChunkBytes, offset = 0 };
        }
        Transfer transfer;
        string key = Text(value, "transfer_id");
        if (!Transfers.TryGetValue(key, out transfer)) throw new ArgumentException("Unknown transfer (worker may have restarted)");
        if (op == "file.close") { Transfers.Remove(key); transfer.Dispose(); return new { closed = true }; }
        if (op == "file.status") return new { offset = transfer.File.Length, size = transfer.Size, upload = transfer.Upload, path = transfer.Path, sha256 = transfer.Digest, expected_sha256 = transfer.Expected, chunk_bytes = ChunkBytes, transfer_id = key };
        if (op == "file.read")
        {
            if (transfer.Upload) throw new ArgumentException("Not a download");
            long offset = value.GetProperty("offset").GetInt64(); int length = value.GetProperty("length").GetInt32();
            if (offset < 0 || offset > transfer.Size || length < 1 || length > ChunkBytes) throw new ArgumentException("Invalid byte range");
            transfer.File.Position = offset;
            byte[] bytes = new byte[(int)Math.Min(length, transfer.Size - offset)];
            int count = 0;
            while (count < bytes.Length) { int read = transfer.File.Read(bytes, count, bytes.Length - count); if (read == 0) throw new IOException("File changed during transfer"); count += read; }
            using (var sha = SHA256.Create()) return new FileChunk { data = bytes, offset = offset, sha256 = HexEncode(sha.ComputeHash(bytes)) };
        }
        if (!transfer.Upload) throw new ArgumentException("Not an upload");
        if (op == "file.write")
        {
            return WriteTransferChunk(key, value.GetProperty("offset").GetInt64(),
                Convert.FromBase64String(Text(value, "data")), Text(value, "sha256"));
        }
        if (op == "file.commit")
        {
            if (transfer.File.Length != transfer.Size || Digest(transfer.File) != transfer.Digest) throw new IOException("Upload digest or size mismatch");
            CheckedPath(transfer.Path);
            if (transfer.Expected == "absent")
            {
                // link is an atomic create-only publication on the same filesystem.
                if (link(transfer.Temporary, transfer.Path) != 0) throw new IOException("Target exists or cannot be created");
            }
            else
            {
                if (!File.Exists(transfer.Path) || DigestPath(transfer.Path) != transfer.Expected) throw new IOException("Target hash conflict");
                // Serialized worker operations protect against other agent writes;
                // independent writers must be quiesced by the caller.
                if (rename(transfer.Temporary, transfer.Path) != 0) throw new IOException("Atomic replacement failed");
            }
            Transfers.Remove(key); transfer.Dispose();
            return new { committed = true, sha256 = transfer.Digest, size = transfer.Size };
        }
        throw new ArgumentException("Unknown operation");
    }
    private static object WriteTransferChunk(string key, long offset, byte[] bytes, string digest)
    {
        Transfer transfer;
        if (!Transfers.TryGetValue(key, out transfer)) throw new ArgumentException("Unknown transfer (worker may have restarted)");
        if (!transfer.Upload) throw new ArgumentException("Not an upload");
        using (var sha = SHA256.Create())
            if (bytes.Length == 0 || bytes.Length > ChunkBytes || HexEncode(sha.ComputeHash(bytes)) != digest)
                throw new ArgumentException("Invalid chunk or digest");
        if (offset < 0 || offset != transfer.File.Length || bytes.Length > transfer.Size - offset)
            throw new ArgumentException("Offset conflict; inspect transfer status before retrying");
        transfer.File.Position = offset; transfer.File.Write(bytes, 0, bytes.Length); transfer.File.Flush(true);
        return new { offset = transfer.File.Length };
    }

    private static void CloseTransfers() { foreach (var t in Transfers.Values) t.Dispose(); Transfers.Clear(); }
    [DllImport("libc", SetLastError = true)] private static extern int rename(string from, string to);
    [DllImport("libc", SetLastError = true)] private static extern int link(string from, string to);
}
