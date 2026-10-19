using System;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading;

// A normally signed Tizen .NET service. Native firmware owns app lifetime and
// the single-instance launch rule; shared Telemetry also holds a process lock.
class Service {
 const string Data="/opt/usr/home/owner/apps_rw/MiniTelemetry/data";
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate bool Create(IntPtr data);
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate void Terminate(IntPtr data);
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate void Control(IntPtr control, IntPtr data);
 [StructLayout(LayoutKind.Sequential)] struct Callbacks { public Create create; public Terminate terminate; public Control control; }
 [DllImport("libappcore-agent.so.1")] static extern int service_app_main(int argc,string[] argv,ref Callbacks callbacks,IntPtr data);
 [DllImport("libcapi-appfw-app-control.so.0")] static extern int app_control_get_caller(IntPtr control,out IntPtr caller);
 [DllImport("libcapi-appfw-app-control.so.0")] static extern int app_control_get_extra_data(IntPtr control,string key,out IntPtr value);
 [DllImport("libcapi-appfw-app-control.so.0")] static extern int app_control_get_extra_data_array(IntPtr control,string key,out IntPtr values,out int count);
 [DllImport("libc.so.6")] static extern void free(IntPtr pointer);
 static string Extra(IntPtr control,string key) {
  IntPtr values;int count;
  if(app_control_get_extra_data_array(control,key,out values,out count)!=0){IntPtr value;if(app_control_get_extra_data(control,key,out value)!=0)return null;try{return Marshal.PtrToStringAnsi(value);}finally{free(value);}}
  try { return count==1 ? Marshal.PtrToStringAnsi(Marshal.ReadIntPtr(values)) : null; }
  finally { for(int i=0;i<count;i++)free(Marshal.ReadIntPtr(values,i*IntPtr.Size));free(values); }
 }
 static int started;
 static string ReadBounded(string path) {
  if((File.GetAttributes(path)&FileAttributes.ReparsePoint)!=0)throw new IOException("Symlink");
  using(var reader=new StreamReader(path)){var buffer=new char[4097];int count=reader.ReadBlock(buffer,0,buffer.Length);if(count>4096)throw new IOException("Oversize configuration");return new string(buffer,0,count);}
 }
 static string Device() {
  using(var config=JsonDocument.Parse(ReadBounded(Data+"/config.json"))) {
   string device=config.RootElement.GetProperty("device_id").GetString();
   if(device!="s90d" && device!="qn90a")throw new IOException("Device identity");
   return device;
  }
 }
 static bool ValidEndpoint(string endpoint,string device) {
  Uri uri;return Uri.TryCreate(endpoint,UriKind.Absolute,out uri) && uri.Scheme=="https" && uri.UserInfo=="" && uri.Query=="" && uri.Fragment=="" &&
   (uri.AbsolutePath=="/v1/devices/"+device || (device=="s90d" && uri.AbsolutePath=="/v1/s90d"));
 }
 static void Preferences(IntPtr control,IntPtr unused) {
  try {
   IntPtr caller;
   if(app_control_get_caller(control,out caller)!=0)return;
   string id;try{id=Marshal.PtrToStringAnsi(caller);}finally{free(caller);}
   if(id!="MiniTelemetry.Start")return;
   string enabled=Extra(control,"telemetry.enabled"),endpoint=Extra(control,"telemetry.receiver_url");
   if((enabled!="true"&&enabled!="false") || endpoint==null || endpoint.Length>512)return;
   string device=Device();if(!ValidEndpoint(endpoint,device))return;
   var uri=new Uri(endpoint);
   string text=JsonSerializer.Serialize(new {schema=1,enabled=enabled=="true",endpoint=uri.AbsoluteUri});
   string path=Data+"/preferences.json";
   if(!File.Exists(path) || ReadBounded(path)!=text) {
    File.WriteAllText(path+".new",text);File.Move(path+".new",path,true);
   }
   StartCollector(device);
  } catch { Console.Error.WriteLine("Telemetry preferences unavailable"); }
 }
 static void StartCollector(string device) {
  // The native candidate retains this caller-validated preference adapter.
  // Its candidate handoff renames enabled to native-enabled, so
  // the old managed loop also exits. Do not load another sampler on Hub return.
  if(NativeSelected(Data,device))return;
  if(Interlocked.CompareExchange(ref started,1,0)!=0)return;
  var thread=new Thread(()=>{
   try { Assembly.LoadFrom(Path.Combine(AppContext.BaseDirectory,"Telemetry.dll")).GetType("Telemetry").GetMethod("RunWithPaths").Invoke(null,new object[]{Data,"/tmp/minimal-telemetry-"+device}); }
   catch { Console.Error.WriteLine("Telemetry collection unavailable"); }
   finally { Interlocked.Exchange(ref started,0); }
  }){IsBackground=true,Name="TVTelemetry"};
  try { thread.Start(); } catch { Interlocked.Exchange(ref started,0);throw; }
 }
 static bool NativeSelected(string root,string device) {
  if(device!="qn90a")return false;
  string marker=root+"/native-enabled";
  // A malformed selection must not silently fall back to a second sampler.
  try { File.GetAttributes(marker);return true; }
  catch(FileNotFoundException){return false;}
  catch(DirectoryNotFoundException){return false;}
 }
 static int Main(string[] args) {
  var callbacks=new Callbacks{create=_=>true,terminate=_=>{},control=Preferences};
  var argv=new string[args.Length+1];argv[0]=string.Empty;args.CopyTo(argv,1);
  int result=service_app_main(argv.Length,argv,ref callbacks,IntPtr.Zero);
  GC.KeepAlive(callbacks);return result;
 }
}
