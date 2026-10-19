// Original Couchroot job supervision and app-user profile (0BSD).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

internal static partial class SamsungTvRootAgent
{
    private const string JobRoot = "/opt/couchroot-agent/jobs";
    private sealed class LogRing
    {
        private readonly byte[] bytes = new byte[1024 * 1024];
        internal long End;
        internal void Add(byte[] data, int count) { lock (this) { for (int i=0;i<count;i++) bytes[(End++) % bytes.Length]=data[i]; } }
        internal object Read(long cursor) { lock (this) {
            long start=Math.Max(0,End-bytes.Length), at=Math.Max(start,cursor);
            if(cursor<0 || cursor>End) throw new ArgumentException("Invalid output cursor");
            int count=(int)Math.Min(65536,End-at); byte[] result=new byte[count];
            for(int i=0;i<count;i++) result[i]=bytes[(at+i)%bytes.Length];
            return new { data=Convert.ToBase64String(result), next_cursor=at+count, truncated=cursor<start, end_cursor=End };
        } }
    }
    private sealed class Job
    {
        internal string Id, Boot, State="starting", Started, ProcessStart;
        internal Process Process;
        internal int? Exit;
        internal bool TimedOut, Finished;
        internal readonly LogRing Output=new LogRing(), Error=new LogRing();
        internal object Snapshot() { return new { id=Id, boot_id=Boot, state=State, started_at=Started, pid=Process == null ? 0 : Process.Id, process_start=ProcessStart, exit_code=Exit, timed_out=TimedOut }; }
        internal void Save() { string file=JobRoot+"/"+Id+".json", temp=file+".next"; File.WriteAllText(temp,JsonSerializer.Serialize(Snapshot())); chmod(temp,384); if(rename(temp,file)!=0) throw new IOException("Cannot persist job state"); }
    }
    private static readonly Dictionary<string, Job> Jobs = new Dictionary<string, Job>();
    private static string BootId() { return File.ReadAllText("/proc/sys/kernel/random/boot_id").Trim(); }
    private static void ManagedDirectory(string directory, int mode)
    {
        CheckedPath(directory);
        // mkdir is exclusive: an existing directory must already be root-owned.
        if (mkdir(directory, (uint)mode) != 0)
        {
            var check = new ProcessStartInfo("/bin/sh") { UseShellExecute=false, RedirectStandardOutput=true, RedirectStandardError=true };
            check.ArgumentList.Add("-c");check.ArgumentList.Add("stat -c %u -- "+ShellQuote(directory));
            using(var process=Process.Start(check))
            {
                string owner=process.StandardOutput.ReadToEnd().Trim();process.WaitForExit();
                if(process.ExitCode!=0 || owner!="0")throw new IOException("Managed directory must be owned by root");
            }
        }
        if(chmod(directory,mode)!=0)throw new IOException("Cannot protect managed directory");
    }
    private static void JobDirectory()
    {
        ManagedDirectory("/opt/couchroot-agent",493);
        ManagedDirectory(JobRoot,448);
    }
    private static string ProcessIdentity(int pid)
    {
        string stat=File.ReadAllText("/proc/"+pid+"/stat"); return stat.Substring(stat.LastIndexOf(')')+2).Split(' ')[19];
    }
    private static string StartedProcessIdentity(Process process)
    {
        try { return ProcessIdentity(process.Id); }
        // A short command may be reaped before procfs is read (ENOENT or ESRCH).
        // Only the tracked process exit proves that missing identity is benign.
        catch(IOException) when (process.HasExited) { return null; }
    }
    private static async Task Drain(Stream stream, LogRing log)
    {
        byte[] buffer=new byte[8192]; int count;
        while((count=await stream.ReadAsync(buffer,0,buffer.Length))>0) log.Add(buffer,count);
    }
    private static string ShellQuote(string value) { return "'"+value.Replace("'","'\\''")+"'"; }
    private static object JobOperation(JsonElement value)
    {
        JobDirectory(); string op=Text(value,"op"),id=Text(value,"id");
        if(!System.Text.RegularExpressions.Regex.IsMatch(id,"^[a-zA-Z0-9-]{16,64}$")) throw new ArgumentException("Invalid job ID");
        string file=JobRoot+"/"+id+".json"; Job job;
        if(op=="job.start")
        {
            if(Jobs.Count>=16 || Directory.GetFiles(JobRoot,"*.json").Length>=64) throw new IOException("Job retention limit reached; forget completed jobs");
            int timeout=value.GetProperty("timeout_ms").GetInt32();string command=Text(value,"command"),profile=Text(value,"profile");
            if(timeout<100 || timeout>86400000 || Encoding.UTF8.GetByteCount(command)>16384 || string.IsNullOrWhiteSpace(command) || command.IndexOf('\0')>=0 || (profile!="root" && profile!="app")) throw new ArgumentException("Invalid job request");
            string launchCommand = profile=="app" ? AppCommand(command) : command;
            // Persist intent exclusively before process launch. Lost starts are never replayed.
            using(var intent=new FileStream(file,FileMode.CreateNew,FileAccess.Write,FileShare.None)) { byte[] bytes=Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new {id,boot_id=BootId(),state="unknown",pid=0}));intent.Write(bytes,0,bytes.Length);intent.Flush(true); }
            if(chmod(file,384)!=0) throw new IOException("Cannot protect job record");
            job=new Job{Id=id,Boot=BootId(),Started=DateTime.UtcNow.ToString("o")};
            var start=new ProcessStartInfo("/usr/bin/setsid"){UseShellExecute=false,RedirectStandardOutput=true,RedirectStandardError=true};
            start.ArgumentList.Add("/bin/sh");start.ArgumentList.Add("-c");start.ArgumentList.Add(launchCommand);
            try
            {
                job.Process=Process.Start(start);
                job.ProcessStart=StartedProcessIdentity(job.Process);
                job.State="running";job.Save();Jobs.Add(id,job);
            }
            catch
            {
                if(job.Process!=null){kill(-job.Process.Id,SignalKill);if(!job.Process.HasExited)job.Process.Kill();job.Process.Dispose();}
                throw;
            }
            Task.Run(async ()=>{
                try {
                    var output=Drain(job.Process.StandardOutput.BaseStream,job.Output);var error=Drain(job.Process.StandardError.BaseStream,job.Error);
                    var exit=Task.Run(()=>job.Process.WaitForExit());
                    var all=Task.WhenAll(exit,output,error);
                    if(await Task.WhenAny(all,Task.Delay(timeout))!=all){lock(job){if(job.State=="running"){job.TimedOut=true;job.State="timed_out";}kill(-job.Process.Id,SignalKill);}}
                    // A detached descendant must not hold supervision forever.
                    await Task.WhenAny(all,Task.Delay(2000));
                    lock(job){if(job.Process.HasExited)job.Exit=job.Process.ExitCode;if(job.State=="running")job.State="completed";if(job.State=="cancelling")job.State="cancelled";job.Finished=true;job.Save();}
                } catch {lock(job){job.State="unknown";job.Finished=true;try{job.Save();}catch{}}}
            });
            return job.Snapshot();
        }
        if(Jobs.TryGetValue(id,out job))
        {
            lock(job)
            {
                if(op=="job.status")return job.Snapshot();
                if(op=="job.output")return new {stdout=job.Output.Read(value.GetProperty("stdout_cursor").GetInt64()),stderr=job.Error.Read(value.GetProperty("stderr_cursor").GetInt64()),state=job.State};
                if(op=="job.cancel") { if(job.State=="running"){if(kill(-job.Process.Id,SignalKill)!=0 && kill(job.Process.Id,SignalKill)!=0 && !job.Process.HasExited)throw new IOException("Cannot cancel process group");job.State="cancelling";job.Save();}return job.Snapshot(); }
                if(op=="job.forget") {if(!job.Finished || !job.Process.HasExited)throw new IOException("Job still active");Jobs.Remove(id);job.Process.Dispose();File.Delete(file);return new { forgotten=true };}
            }
        }
        else
        {
            using(var saved=JsonDocument.Parse(File.ReadAllText(file)))
            {
                var record=saved.RootElement;bool rebooted=Text(record,"boot_id")!=BootId();string state=Text(record,"state");
                if(op=="job.status")return new {id,boot_id=Text(record,"boot_id"),state=(state=="running" || state=="starting" || state=="cancelling" || state=="unknown")?(rebooted?"interrupted":"unknown"):state,record=record.Clone(),output_available=false};
                if(op=="job.cancel" && !rebooted && record.GetProperty("pid").GetInt32()>0)
                {
                    int pid=record.GetProperty("pid").GetInt32();
                    if(ProcessIdentity(pid)!=Text(record,"process_start"))throw new IOException("Process identity changed; cancellation refused");
                    if(kill(-pid,SignalKill)!=0)throw new IOException("Cannot cancel process group");
                    return new {id,state="cancel_requested"};
                }
                // Reconciled native interruptions are terminal even on this boot.
                // Forget only their saved metadata; uncertain/live records stay refused.
                if(op=="job.forget" && (rebooted || state=="completed" || state=="timed_out" || state=="cancelled" || state=="interrupted")){File.Delete(file);return new {forgotten=true};}
            }
        }
        throw new ArgumentException("Operation unavailable; inspect job status");
    }
    private static void StopJobs() { foreach(var job in Jobs.Values) lock(job){if(job.State=="running"){kill(-job.Process.Id,SignalKill);job.State="interrupted";try{job.Save();}catch{}}} }
    [DllImport("libc", SetLastError=true)]private static extern int mkdir(string path,uint mode);
}
