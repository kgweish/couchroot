// SPDX-License-Identifier: 0BSD
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
class NativeEntry {
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    delegate int Entry(int mode, [MarshalAs(UnmanagedType.LPStr)] string package);
    [DllImport("libc.so.6", SetLastError=true)] static extern int unshare(int flags);
    [DllImport("libc.so.6", SetLastError=true)] static extern int mount(string source, string target, string fs, UIntPtr flags, string data);
    [DllImport("libc.so.6", SetLastError=true)] static extern int umount2(string target, int flags);
    static int Main(string[] args) {
        if (IntPtr.Size != 4 || args.Length != 2 ||
            !Regex.IsMatch(args[1], @"\Aarchive-root-[a-f0-9]{16}\z") ||
            (args[0] != "probe" && args[0] != "identity")) return 2;
        string stage = "/home/owner/share/tmp/sdk_tools/" + args[1], code = stage + "/code";
        // The QN90A host canonicalizes /home to /opt/usr/home before loading.
        string location = Path.GetDirectoryName(typeof(NativeEntry).Assembly.Location);
        if (location != stage && location != "/opt/usr" + stage) {
            Console.Error.WriteLine("Service assembly location mismatch"); return 2;
        }
        bool mounted = false; int result = 1; IntPtr library = IntPtr.Zero;
        try {
            if (args[0] == "probe") {
                if (unshare(0x20000) != 0 || mount(null,"/",null,new UIntPtr(0x44000),null) != 0)
                    throw new Exception("Private code namespace failed");
                if (File.ReadAllText("/proc/self/mountinfo").Contains(" shared:"))
                    throw new Exception("Shared code propagation");
                if (mount(code,code,null,new UIntPtr(4096),null) != 0)
                    throw new Exception("Private code bind failed");
                mounted = true;
                if (mount(null,code,null,new UIntPtr(4096|32|1),null) != 0)
                    throw new Exception("Read-only code remount failed");
            }
            library = NativeLibrary.Load(code + "/libacquire.so");
            var entry = Marshal.GetDelegateForFunctionPointer<Entry>(NativeLibrary.GetExport(library,"native_service_entry"));
            result = entry(args[0] == "probe" ? 0 : 1, args[1]);
        } catch (Exception e) { Console.Error.WriteLine("Native service entry unconfirmed: " + e.Message); }
        finally {
            if (library != IntPtr.Zero) NativeLibrary.Free(library);
            if (mounted && umount2(code,2) != 0) result = 1;
        }
        return result;
    }
}
