using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Security.Cryptography;
class Harness { public static int Main(string[] args){if(args.Length==2 && args[0]=="--validate-staging"){try{Console.WriteLine(SamsungTvRootAgent.ValidateProductionStaging(args[1]));return 0;}catch(ArgumentException){return 64;}}if(args.Length==1 && args[0]=="--job-identity-test")return SamsungTvRootAgent.TestStartedProcessIdentity();if(args.Length==3 && args[0]=="--parity-wire")return SamsungTvRootAgent.ParityWire(int.Parse(args[1]),args[2]);if(args.Length==2 && args[0]=="--parity")return SamsungTvRootAgent.ParityBridge(args[1]);if(args.Length==1 && args[0]=="--native-resource"){using(var resource=typeof(SamsungTvRootAgent).Assembly.GetManifestResourceStream("Couchroot.AppLauncher")){if(resource==null)throw new Exception("Missing resource");Console.WriteLine("NATIVE_RESOURCE_SHA256 "+Convert.ToHexString(SHA256.HashData(resource)).ToLowerInvariant());}return 0;}if(args.Length>0)return SamsungTvRootAgent.Main(args);SamsungTvRootAgent.TestOperations();return 0;} }
internal static partial class SamsungTvRootAgent
{
    public static string ValidateProductionStaging(string value){return ValidateStagingDirectory(value);}
    private static void Check(bool value,string message){if(!value)throw new Exception(message);}
    private static JsonElement Call(object request,string root){using(var doc=JsonDocument.Parse(JsonSerializer.Serialize(request)))return JsonSerializer.SerializeToElement(Operation(doc.RootElement,root,root));}
    private static void Reject(Action action,string message){try{action();}catch(ArgumentException){return;}catch(InvalidDataException){return;}catch(IOException){return;}throw new Exception(message);}
    private static void TestReadOpenFlags()
    {
        Check(ReadOpenFlags(false, System.Runtime.InteropServices.Architecture.Arm) == 0x28800, "ARM32 O_NOFOLLOW/O_LARGEFILE differ");
        Check(ReadOpenFlags(false, System.Runtime.InteropServices.Architecture.Arm64) == 0x8800, "ARM64 flags differ");
        Check(ReadOpenFlags(false, System.Runtime.InteropServices.Architecture.X64) == 0x20800, "x64 flags differ");
        Check(ReadOpenFlags(true, System.Runtime.InteropServices.Architecture.Arm64) == 0x104, "Darwin flags differ");
    }
    private static void TestExecDrain(string root)
    {
        string marker = root + "exec-background-survived";
        var clock = System.Diagnostics.Stopwatch.StartNew();
        var result = Execute("(sleep 1; touch " + ShellQuote(marker) + ") & printf done; printf error >&2; exit 7", 3000);
        Check(clock.ElapsedMilliseconds < 2500, "EXEC waited for background pipe owners");
        Check(result.ExitCode == 7 && !result.TimedOut, "EXEC lost leader exit status");
        Check(System.Text.Encoding.UTF8.GetString(result.StandardOutput) == "done", "EXEC lost stdout");
        Check(System.Text.Encoding.UTF8.GetString(result.StandardError) == "error", "EXEC lost stderr");
        System.Threading.Thread.Sleep(1200);
        Check(!File.Exists(marker), "EXEC background child survived leader exit");
        clock.Restart();
        string ready = root + "exec-escaped-ready";
        string escaped = "printf ready > " + ShellQuote(ready) + "; sleep 4";
        Reject(() => Execute("setsid /bin/sh -c " + ShellQuote(escaped) + " & while [ ! -s " + ShellQuote(ready) + " ]; do sleep .01; done", 3000), "escaped pipe owner allowed success");
        Check(clock.ElapsedMilliseconds < 2500, "escaped pipe owner blocked output drain");
        clock.Restart();
        result = Execute("sleep 10", 100);
        Check(result.TimedOut && result.ExitCode == 124 && clock.ElapsedMilliseconds < 2500, "EXEC timeout is unbounded");
        Console.WriteLine("PASS EXEC background cleanup, escaped-pipe drain bound and timeout");
    }
    private static void TestJobs(string root)
    {
        TestExecDrain(root);
        // Exercise the actual process boundary, including nested launcher quoting.
        string expected="apostrophe's \"double\" and \\backslash\nnext line";
        string command="printf '%s' "+ShellQuote(expected);
        var direct=Execute(command,5000);
        Check(direct.ExitCode==0 && System.Text.Encoding.UTF8.GetString(direct.StandardOutput)==expected,"root command argument corruption");
        string launcher=root+"argument-launcher";
        File.WriteAllText(launcher,"#!/bin/sh\n[ \"$#\" -eq 2 ] && [ \"$1\" = --command ] || exit 64\nexec /bin/sh -c \"$2\"\n");
        Check(chmod(launcher,320)==0,"cannot protect test launcher");
        AppLauncherPath=launcher;AppLauncherDigest=DigestPath(launcher);
        try {
            var launched=Execute(AppCommand(command),5000);
            Check(launched.ExitCode==0 && System.Text.Encoding.UTF8.GetString(launched.StandardOutput)==expected,"native launcher argument corruption");
        } finally {AppLauncherPath=AppLauncherDigest=null;File.Delete(launcher);}
        string id=Guid.NewGuid().ToString("N");
        Call(new{op="job.start",id,command="printf hello; printf error >&2; exit 7",profile="root",timeout_ms=5000},root);
        JsonElement status=default;
        for(int i=0;i<100;i++){status=Call(new{op="job.status",id},root);if(status.GetProperty("state").GetString()!="running")break;System.Threading.Thread.Sleep(20);}
        Check(status.GetProperty("exit_code").GetInt32()==7,"job exit code differs");
        var output=Call(new{op="job.output",id,stdout_cursor=0,stderr_cursor=0},root);
        Check(Convert.FromBase64String(output.GetProperty("stdout").GetProperty("data").GetString()).SequenceEqual(System.Text.Encoding.UTF8.GetBytes("hello")),"job stdout differs");
        Reject(()=>Call(new{op="job.start",id,command="true",profile="root",timeout_ms=1000},root),"duplicate job ran");
        Call(new{op="job.forget",id},root);
        foreach(bool cancel in new[]{false,true}){
            id=Guid.NewGuid().ToString("N");
            Call(new{op="job.start",id,command="sleep 1; touch "+ShellQuote(root+id+"-survived"),profile="root",timeout_ms=cancel?10000:150},root);
            if(cancel)Call(new{op="job.cancel",id},root);
            for(int i=0;i<150;i++){status=Call(new{op="job.status",id},root);if(Jobs[id].Finished)break;System.Threading.Thread.Sleep(20);}
            Check(Jobs[id].Finished,"job did not finish");
            Check(status.GetProperty("state").GetString()==(cancel?"cancelled":"timed_out"),"wrong cancellation/timeout state");
            System.Threading.Thread.Sleep(1200);Check(!File.Exists(root+id+"-survived"),"cancelled command continued executing");
            Call(new{op="job.forget",id},root);
        }
        // A saved record from another boot cannot claim that work is still running.
        id=Guid.NewGuid().ToString("N");File.WriteAllText(JobRoot+"/"+id+".json",JsonSerializer.Serialize(new{id,boot_id="previous-boot",state="running",pid=123}));
        Check(Call(new{op="job.status",id},root).GetProperty("state").GetString()=="interrupted","old boot job was ready");
        Call(new{op="job.forget",id},root);
        Console.WriteLine("PASS Linux jobs: nonzero results, output, duplicate start, process-group cancellation, timeout and reboot interruption");
    }
    public static void TestOperations()
    {
        TestProtocolReader();
        TestReadOpenFlags();
        Reject(()=>AppCommand("echo should-not-run"),"unprepared native launcher accepted");
        string root=Path.GetTempPath()+"couchroot-operations-"+Guid.NewGuid().ToString("N")+"/";
        if(System.Runtime.InteropServices.RuntimeInformation.IsOSPlatform(System.Runtime.InteropServices.OSPlatform.OSX) && root.StartsWith("/var/"))root="/private"+root;
        Directory.CreateDirectory(root);
        try {
            TestBinaryUploads(root);
            string native=root+"native-launcher";File.WriteAllText(native,"test launcher bytes");
            AppLauncherPath=native;AppLauncherDigest=DigestPath(native);
            Check(AppCommand("printf '%s' 'quoted command'")=="exec "+ShellQuote(native)+" --command "+ShellQuote("printf '%s' 'quoted command'"),"native command quoting differs");
            File.AppendAllText(native,"tampered");Reject(()=>AppCommand("echo should-not-run"),"tampered launcher accepted");
            AppLauncherPath=AppLauncherDigest=null;
            byte[] bytes=new byte[5*1024*1024+17];new Random(4).NextBytes(bytes);
            string digest=HexEncode(SHA256.HashData(bytes)),target=root+"large.bin";
            var session=Call(new {op="file.begin",path=target,size=bytes.Length,sha256=digest,expected_sha256="absent"},root);
            string id=session.GetProperty("transfer_id").GetString();
            Reject(()=>Call(new {op="file.write",transfer_id=id,offset=0,sha256=digest,data=Convert.ToBase64String(new byte[]{1})},root),"corrupt chunk accepted");
            for(int offset=0;offset<bytes.Length;offset+=ChunkBytes){byte[] chunk=bytes.Skip(offset).Take(ChunkBytes).ToArray();Call(new{op="file.write",transfer_id=id,offset,sha256=HexEncode(SHA256.HashData(chunk)),data=Convert.ToBase64String(chunk)},root);}
            Reject(()=>Call(new {op="file.write",transfer_id=id,offset=0,sha256=HexEncode(SHA256.HashData(new byte[]{1})),data="AQ=="},root),"replayed offset accepted");
            Call(new{op="file.commit",transfer_id=id},root);Check(File.ReadAllBytes(target).SequenceEqual(bytes),"large upload differs");
            session=Call(new{op="file.open",path=target},root);id=session.GetProperty("transfer_id").GetString();
            Check(session.GetProperty("sha256").GetString()==digest,"download hash differs");
            var range=Call(new{op="file.read",transfer_id=id,offset=1048573,length=ChunkBytes},root);
            Check(Convert.FromBase64String(range.GetProperty("data").GetString()).SequenceEqual(bytes.Skip(1048573).Take(ChunkBytes)),"unaligned byte range differs");
            Call(new{op="file.close",transfer_id=id},root);
            foreach(string expected in new[]{"absent",new string('0',64),digest}){
                session=Call(new{op="file.begin",path=target,size=0,sha256=HexEncode(SHA256.HashData(Array.Empty<byte>())),expected_sha256=expected},root);id=session.GetProperty("transfer_id").GetString();
                if(expected==digest)Call(new{op="file.commit",transfer_id=id},root);
                else {Reject(()=>Call(new{op="file.commit",transfer_id=id},root),"conflicting replacement accepted");Check(File.ReadAllBytes(target).SequenceEqual(bytes),"conflict changed target");Call(new{op="file.close",transfer_id=id},root);}
            }
            Check(new FileInfo(target).Length==0,"conditional replacement failed");
            File.CreateSymbolicLink(root+"link",target);
            Reject(()=>Call(new{op="file.open",path=root+"link"},root),"symlink accepted");
            // Bypass the preliminary path check: a leaf replaced after that
            // check must also be rejected by the actual open syscall.
            int linkFd = open(root+"link", ReadOpenFlags(System.Runtime.InteropServices.RuntimeInformation.IsOSPlatform(System.Runtime.InteropServices.OSPlatform.OSX), System.Runtime.InteropServices.RuntimeInformation.ProcessArchitecture));
            if (linkFd >= 0) new Microsoft.Win32.SafeHandles.SafeFileHandle((IntPtr)linkFd, true).Dispose();
            Check(linkFd < 0, "open followed a symlink after path validation");
            Reject(()=>Call(new{op="file.begin",path="/etc/not-allowed",size=0,sha256=digest,expected_sha256="absent"},root),"outside write allowlist accepted");
            var log=new LogRing();log.Add(bytes,bytes.Length);var tail=JsonSerializer.SerializeToElement(log.Read(0));
            Check(tail.GetProperty("truncated").GetBoolean(),"log truncation missing");
            long start=bytes.Length-1048576;Check(Convert.FromBase64String(tail.GetProperty("data").GetString()).SequenceEqual(bytes.Skip((int)start).Take(65536)),"ring cursor data differs");
            Reject(()=>log.Read(-1),"negative cursor accepted");
            if(System.Runtime.InteropServices.RuntimeInformation.IsOSPlatform(System.Runtime.InteropServices.OSPlatform.Linux) && getuid()==0) TestJobs(root);
            Console.WriteLine("PASS large transfer, ranges, digest rejection, offset replay, conditional replacement, symlinks, allowlists and bounded log cursors");
        } finally {CloseTransfers();Directory.Delete(root,true);}
    }
}
