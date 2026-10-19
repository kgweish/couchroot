// SPDX-License-Identifier: 0BSD
using System;
using System.IO;
using System.Runtime.InteropServices;
class NativeEntry {
#if QN90A
    const string Code = "/home/owner/share/tmp/sdk_tools/couchroot-native-root-qn90a/code";
#else
    const string Code = "/home/owner/share/tmp/sdk_tools/couchroot-native-root-s90d/code";
#endif
    [DllImport(Code + "/libacquire.so", CallingConvention = CallingConvention.Cdecl)]
    static extern int native_entry(int mode);
    [DllImport("libc.so.6", SetLastError=true)] static extern int unshare(int flags);
    [DllImport("libc.so.6", SetLastError=true)] static extern int mount(string source, string target, string fs, UIntPtr flags, string data);
    [DllImport("libc.so.6", SetLastError=true)] static extern int umount2(string target, int flags);
    static int Main(string[] args) {
        if (IntPtr.Size != 4 || args.Length != 1) return 2;
        // Identity children inherit the parent's private read-only code bind.
        if (args[0] == "identity") return native_entry(1);
        if (args[0] != "probe") return 2;
        bool mounted = false;
        int result = 1;
        try {
            // Writable SDK mappings are refused on QN90A. Establish only the
            // prerequisite code mount here, before loading any native library.
            if (unshare(0x20000) != 0 || mount(null,"/",null,new UIntPtr(0x44000),null) != 0)
                throw new Exception("Private code namespace failed");
            if (File.ReadAllText("/proc/self/mountinfo").Contains(" shared:"))
                throw new Exception("Shared code mount propagation");
            if (mount(Code,Code,null,new UIntPtr(4096),null) != 0)
                throw new Exception("Private code bind failed");
            mounted = true;
            if (mount(null,Code,null,new UIntPtr(4096|32|1),null) != 0)
                throw new Exception("Read-only code remount failed");
            result = native_entry(0);
        } catch (Exception e) { Console.Error.WriteLine("Native entry unconfirmed: "+e.Message); }
        finally { if (mounted && umount2(Code,2) != 0) result = 1; }
        return result;
    }
}
