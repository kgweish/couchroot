using System;
using System.Collections.Generic;
using System.Reflection;
static class Inspector {
 public static int Calls;
 public static object Sample(double uptime){Calls++;return new {uptime};}
}
class ScopeHarness {
 static void Check(bool ok){if(!ok)throw new Exception("Telemetry scope assertion failed");}
 static bool Add(Dictionary<string,object> sample,string device,double now,double next) =>
  (bool)typeof(Telemetry).GetMethod("AddInspector",BindingFlags.NonPublic|BindingFlags.Static).Invoke(null,new object[]{sample,device,now,next});
 static void Main() {
  // Even an overdue QN90A inventory must not enter the inspector at all.
  foreach(double now in new[]{60d,120d,86400d}) {
   var sample=new Dictionary<string,object>{{"uptime",now},{"stat","cpu counters"}};
   Check(!Add(sample,"qn90a",now,0));Check(!sample.ContainsKey("inspector"));
   Check((string)sample["stat"]=="cpu counters");Check(Inspector.Calls==0);
  }
  var s90d=new Dictionary<string,object>{{"uptime",120d}};
  Check(!Add(s90d,"s90d",120,180));Check(Inspector.Calls==0);
  Check(Add(s90d,"s90d",120,120));Check(s90d.ContainsKey("inspector"));Check(Inspector.Calls==1);
  Console.WriteLine("PASS: QN90A skips inspector collection; S90D cadence retained");
 }
}
