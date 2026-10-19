using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;

public static class Telemetry {
    static string Root = "/opt/minimal-telemetry";
    static string Runtime = "/run/minimal-telemetry";
    [DllImport("libc.so.6", SetLastError=true)] static extern int flock(int fd, int operation);
    [DllImport("libc.so.6")] static extern int nice(int increment);
    static string Read(string path, int limit=16384) {
        using var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
        byte[] bytes = new byte[limit+1];
        int count=0, n;
        while (count<bytes.Length && (n=file.Read(bytes,count,bytes.Length-count))>0) count+=n;
        if(count>limit) throw new IOException("Counter exceeds limit");
        return Encoding.UTF8.GetString(bytes,0,count);
    }
    [DllImport("libc.so.6")] static extern int getpid();
    [DllImport("libc.so.6")] static extern int chmod(string path, uint mode);
    [DllImport("libvconf.so.0")] static extern IntPtr vconf_get_str(string key);
    [DllImport("libc.so.6")] static extern void free(IntPtr p);
    static byte[] Hash(byte[] bytes) { using var sha=SHA256.Create(); return sha.ComputeHash(bytes); }
    static byte[] Unhex(string text) { byte[] bytes=new byte[text.Length/2];for(int i=0;i<bytes.Length;i++)bytes[i]=Convert.ToByte(text.Substring(i*2,2),16);return bytes; }
    static bool Link(string path) => (File.Exists(path) || Directory.Exists(path)) && (File.GetAttributes(path)&FileAttributes.ReparsePoint)!=0;
    static string Optional(string path) { try { return Read(path); } catch(IOException) { return null; } catch(UnauthorizedAccessException) { return null; } }
    static bool DashboardReady(string strategy) {
        if(strategy=="launcher-service")return true;
        if(strategy=="s90d-helper")return File.Exists("/tmp/root_app_resume_requested");
        IntPtr p=vconf_get_str("memory/appfw/current_fullscreen_appid");
        if(p==IntPtr.Zero)return false;
        try { return Marshal.PtrToStringAnsi(p)=="MiniHub001.Hub"; } finally { free(p); }
    }
    static bool ValidUri(Uri uri,string device) => uri.Scheme=="https" && uri.UserInfo=="" && uri.Query=="" && uri.Fragment=="" &&
        (uri.AbsolutePath=="/v1/devices/"+device || (device=="s90d" && uri.AbsolutePath=="/v1/s90d"));
    static bool Enabled() => File.Exists(Root+"/enabled");
    static double Uptime() => double.Parse(Read("/proc/uptime",128).Split(' ')[0], CultureInfo.InvariantCulture);
    public static Dictionary<string,object> Sample(long sequence, string boot) {
        using var self=Process.GetCurrentProcess();
        return new Dictionary<string,object> {
            ["schema"]=1,["boot"]=boot,["seq"]=sequence,["uptime"]=Uptime(),
            ["stat"]=Optional("/proc/stat"),["meminfo"]=Optional("/proc/meminfo"),
            ["netdev"]=Optional("/proc/net/dev"),["diskstats"]=Optional("/proc/diskstats"),
            ["collector_cpu_seconds"]=self.TotalProcessorTime.TotalSeconds,
            ["collector_rss_bytes"]=self.WorkingSet64
        };
    }
    // QN90A intentionally keeps counters only, including the managed rollback path.
    static bool AddInspector(Dictionary<string,object> sample, string device, double now, double next) {
        if(device=="qn90a" || now<next)return false;
        sample["inspector"]=Inspector.Sample((double)sample["uptime"]);
        return true;
    }
    public static int Main(string[] args) {
        if(args.Length==1 && args[0]=="--sample") {
            Console.WriteLine(JsonSerializer.Serialize(Sample(1,Read("/proc/sys/kernel/random/boot_id",64).Trim())));return 0;
        }
        return Run();
    }
    public static int RunWithPaths(string root, string runtime) { Root=root;Runtime=runtime;return Run(); }
    public static int Run() {
        if(!Enabled())return 0;
        if(Link(Runtime))return 1;
        Directory.CreateDirectory(Runtime);chmod(Runtime,448);
        if(Link(Runtime+"/lock"))return 1;
        using var lease=new FileStream(Runtime+"/lock",FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.ReadWrite);
        if(flock(lease.SafeFileHandle.DangerousGetHandle().ToInt32(),2|4)!=0)return 0;
        try {
            nice(10);
            using var config=JsonDocument.Parse(Read(Root+"/config.json",4096));
            var cfg=config.RootElement;
            string device=cfg.GetProperty("device_id").GetString();
            string strategy=cfg.GetProperty("startup").GetString();
            if(!System.Text.RegularExpressions.Regex.IsMatch(device,"^[a-z][a-z0-9_-]{0,47}$"))throw new Exception("Device identity");
            if(IntPtr.Size!=4 || !Read("/etc/prd_info.ini",4096).Contains("Version="+cfg.GetProperty("firmware").GetString()+";"))throw new Exception("Firmware identity");
            if(!RuntimeInformation.FrameworkDescription.Contains(cfg.GetProperty("runtime_version").GetString()))throw new Exception("Runtime identity");
            string preferences=cfg.GetProperty("dashboard_config_path").GetString();
            string endpoint=cfg.GetProperty("endpoint").GetString();
            string pin=cfg.GetProperty("certificate_sha256").GetString();
            string token=cfg.GetProperty("token").GetString();
            var uri=new Uri(endpoint);
            if(!ValidUri(uri,device) || pin.Length!=64 || token.Length<32)throw new Exception("Invalid configuration");
            using var handler=new HttpClientHandler { UseProxy=false,AllowAutoRedirect=false };
            // An exact certificate pin authenticates this private endpoint, including
            // before the television's wall clock has synchronized after cold boot.
            handler.ServerCertificateCustomValidationCallback=(request,cert,chain,errors)=>
                cert!=null && CryptographicOperations.FixedTimeEquals(Hash(cert.RawData),Unhex(pin));
            using var client=new HttpClient(handler) { Timeout=TimeSpan.FromSeconds(3),MaxResponseContentBufferSize=1024 };
            client.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",token);
            string session=Guid.NewGuid().ToString();
            string boot=Read("/proc/sys/kernel/random/boot_id",64).Trim();
            long sequence=0,sent=0,failures=0; bool monitoring=false; string applied="",lastError=""; int backoff=10; double nextSend=0,nextStatus=0,nextInspector=0;
            // No collection or network work during the dashboard's startup window.
            while(Enabled() && (Uptime()<60 || !DashboardReady(strategy)))Thread.Sleep(10000);
            File.WriteAllText(Runtime+"/pid",getpid().ToString());
            while(Enabled()) {
                double now=Uptime();
                try {
                    if(Link(preferences))throw new IOException("Preference symlink");
                    using var prefs=JsonDocument.Parse(Read(preferences,4096));
                    var value=prefs.RootElement;
                    var next=new Uri(value.GetProperty("endpoint").GetString());
                    if(value.GetProperty("schema").GetInt32()!=1 || !ValidUri(next,device))throw new Exception("Invalid receiver URL");
                    monitoring=value.GetProperty("enabled").GetBoolean();
                    string changed=monitoring+" "+next.AbsoluteUri;
                    if(changed!=applied) { uri=next;applied=changed;nextSend=0;backoff=10; }
                } catch { monitoring=false; }
                // proc uptime is quantized; tolerate rounding so a tick is not skipped.
                if(monitoring && now>=nextSend-0.05) {
                    try {
                        var sample=Sample(++sequence,boot);
                        bool inspected=AddInspector(sample,device,now,nextInspector);
                        sample["device"]=device;sample["session"]=session;
                        using var body=new StringContent(JsonSerializer.Serialize(sample),Encoding.UTF8,"application/json");
                        using var response=client.PostAsync(uri,body).GetAwaiter().GetResult();
                        response.EnsureSuccessStatusCode(); sent++;backoff=10;lastError="";
                        if(inspected)nextInspector=now+60;
                    } catch(Exception e) { failures++;backoff=Math.Min(300,backoff*2);lastError=e.GetType().Name+":"+""+":"+e.GetBaseException().GetType().Name; }
                    nextSend=now+backoff;
                }
                if(now>=nextStatus) {
                    File.WriteAllText(Runtime+"/status.new",JsonSerializer.Serialize(new {boot,session,device,pid=getpid(),sequence,sent,failures,last_error=lastError,monitoring,endpoint=uri.AbsoluteUri,retry_seconds=backoff,uptime=now}));
                    File.Move(Runtime+"/status.new",Runtime+"/status.json",true);nextStatus=now+60;
                }
                Thread.Sleep(Math.Max(100,(int)Math.Ceiling(10000-(Uptime()-now)*1000)));
            }
            return 0;
        } catch(Exception e) { Console.Error.WriteLine("Telemetry stopped: "+e.GetType().Name);return 1; }
    }
}
