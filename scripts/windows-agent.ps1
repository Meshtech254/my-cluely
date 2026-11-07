# Fixed local worker. Model arguments are JSON data on stdin, never executable code.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class AgentInput {
 [StructLayout(LayoutKind.Sequential)] public struct RECT { public int left, top, right, bottom; }
 [StructLayout(LayoutKind.Sequential)] public struct POINT { public int x,y; }
 [StructLayout(LayoutKind.Sequential)] public struct GUI { public uint size,flags; public IntPtr active,focus,capture,menu,move,caret; public RECT rect; }
 [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public UNION data; }
 [StructLayout(LayoutKind.Explicit)] public struct UNION { [FieldOffset(0)] public MOUSE mouse; [FieldOffset(0)] public KEY key; }
 [StructLayout(LayoutKind.Sequential)] public struct MOUSE { public int x,y; public uint mouseData,flags,time; public UIntPtr extra; }
 [StructLayout(LayoutKind.Sequential)] public struct KEY { public ushort vk,scan; public uint flags,time; public UIntPtr extra; }
 [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint process);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
 [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
 [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
 [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
 [DllImport("user32.dll")] public static extern bool GetGUIThreadInfo(uint thread,ref GUI info);
 [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll",EntryPoint="GetWindowLongW")] public static extern int GetWindowLong(IntPtr h,int index);
 public static void TypeFocused(string text,long handle) { GUI info=new GUI();info.size=(uint)Marshal.SizeOf(typeof(GUI));if(!GetGUIThreadInfo(0,ref info)||GetAncestor(info.focus,2).ToInt64()!=handle) throw new Exception("Focused control outside selected window");StringBuilder name=new StringBuilder(256);GetClassName(info.focus,name,256);if(!name.ToString().ToLowerInvariant().Contains("edit")||(GetWindowLong(info.focus,-16)&0x820)!=0) throw new Exception("Focused control is not a writable, non-password native text field");Text(text,handle); }
 public static long FocusedHandle(long handle) { GUI info=new GUI();info.size=(uint)Marshal.SizeOf(typeof(GUI));if(!GetGUIThreadInfo(0,ref info)||GetAncestor(info.focus,2).ToInt64()!=handle) throw new Exception("Focused control outside selected window");return info.focus.ToInt64(); }
 [DllImport("user32.dll")] public static extern uint SendInput(uint count, INPUT[] input, int size);
 static void Send(INPUT i) { if(SendInput(1,new INPUT[]{i},Marshal.SizeOf(typeof(INPUT)))!=1) throw new Exception("Windows blocked input"); }
 public static void Key(ushort vk, bool up) { INPUT i=new INPUT(); i.type=1; i.data.key.vk=vk; i.data.key.flags=up?2u:0u; Send(i); }
 static void Batch(INPUT[] inputs) { if(SendInput((uint)inputs.Length,inputs,Marshal.SizeOf(typeof(INPUT)))!=inputs.Length) throw new Exception("Windows blocked input"); }
 public static void Text(string text, long handle) { foreach(char c in text) { if(GetForegroundWindow().ToInt64()!=handle) throw new Exception("Foreground changed"); INPUT down=new INPUT(); down.type=1; down.data.key.scan=c; down.data.key.flags=4; INPUT up=down; up.data.key.flags=6; Batch(new INPUT[]{down,up}); } }
 public static void Shortcut(ushort vk,ushort modifier) { INPUT down=new INPUT(); down.type=1; down.data.key.vk=vk; INPUT up=down; up.data.key.flags=2; if(modifier==0) {Batch(new INPUT[]{down,up});return;} INPUT md=new INPUT();md.type=1;md.data.key.vk=modifier;INPUT mu=md;mu.data.key.flags=2;Batch(new INPUT[]{md,down,up,mu}); }
 public static void Click(uint downFlag,uint upFlag) { INPUT down=new INPUT(); down.data.mouse.flags=downFlag;INPUT up=down;up.data.mouse.flags=upFlag;Batch(new INPUT[]{down,up}); }
 public static void Mouse(uint flags,int delta) { INPUT i=new INPUT(); i.data.mouse.flags=flags; i.data.mouse.mouseData=unchecked((uint)delta); Send(i); }
}
'@
[void][AgentInput]::SetProcessDPIAware()
while ($line = [Console]::ReadLine()) {
 try {
  $request = $line | ConvertFrom-Json
  $op = $request.op; $a = $request.args
  $h = [IntPtr]([long]$request.handle)
  [uint32]$owner=0
  [void][AgentInput]::GetWindowThreadProcessId($h,[ref]$owner)
  if (-not $selectedOwner) { $selectedOwner=$owner }
  if (-not $owner -or $owner -ne $selectedOwner) { throw 'Selected application closed or window identity changed' }
  if ($op -eq 'inspect') {
   if (-not [AgentInput]::IsWindow($h)) { throw 'Selected window no longer exists' }
   $r = New-Object AgentInput+RECT
   [void][AgentInput]::GetWindowRect($h,[ref]$r)
   $title = New-Object Text.StringBuilder 512
   [void][AgentInput]::GetWindowText($h,$title,512)
   $root = [System.Windows.Automation.AutomationElement]::FromHandle($h)
   $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
   $controls = @(); for ($i=0; $i -lt [Math]::Min($all.Count,300); $i++) {
    $c=$all.Item($i).Current
    if (-not $c.IsPassword -and -not $c.IsOffscreen -and $c.Name) { $controls += @{label=$c.Name;type=$c.ControlType.ProgrammaticName;enabled=$c.IsEnabled} }
   }
   $result = @{handle=$h.ToInt64();processName=(Get-Process -Id $owner).ProcessName;foreground=[AgentInput]::GetForegroundWindow().ToInt64();title=$title.ToString();bounds=@{x=$r.left;y=$r.top;width=$r.right-$r.left;height=$r.bottom-$r.top};controls=$controls;controlCount=$all.Count}
  } elseif ($op -eq 'activate') {
   if ([AgentInput]::GetForegroundWindow() -ne $h -and -not [AgentInput]::SetForegroundWindow($h)) {throw 'Windows denied activation; focus this window manually'}
   $result=@{ok=$true}
  } else {
   if ([AgentInput]::GetForegroundWindow() -ne $h) { throw 'Focus the selected application, then resume. Foreground window does not match.' }
   switch ($op) {
    'type_character' {
     if (-not $typingReady -or ([string]$a.value).Length -gt 2) {throw 'No prepared text field'}
     if ([AgentInput]::FocusedHandle($h.ToInt64()) -ne $typingHandle) {throw 'Field focus changed during typing'}
     if ($typingFallback) { [AgentInput]::TypeFocused([string]$a.value,$h.ToInt64()) }
     else { if (-not $typingElement.Current.HasKeyboardFocus -or $typingElement.Current.IsPassword) {throw 'Field focus changed'}; [AgentInput]::Text([string]$a.value,$h.ToInt64()) }
    }
    'move_mouse' { $hit=[AgentInput]::GetAncestor([AgentInput]::WindowFromPoint([AgentInput+POINT]@{x=$a.x;y=$a.y}),2); if ($hit -ne $h) { throw "Target point ($($a.x),$($a.y)) is outside selected window or is covered (hit $hit, target $h)" }; [void][AgentInput]::SetCursorPos($a.x,$a.y) }
    'click_coordinates' {
     if ([AgentInput]::GetAncestor([AgentInput]::WindowFromPoint([AgentInput+POINT]@{x=$a.x;y=$a.y}),2) -ne $h) { throw 'Target point is outside selected window or is covered' }
     [void][AgentInput]::SetCursorPos($a.x,$a.y)
     $down=2; $up=4; if ($a.button -eq 'right') {$down=8;$up=16}
     for ($i=0;$i -lt $a.count;$i++) { [AgentInput]::Click($down,$up) }
    }
    'scroll' { $point=New-Object AgentInput+POINT; [void][AgentInput]::GetCursorPos([ref]$point); if ([AgentInput]::GetAncestor([AgentInput]::WindowFromPoint($point),2) -ne $h) {throw 'Move cursor into selected window before scrolling'}; [AgentInput]::Mouse(2048,-[int]$a.delta) }
    'press_key' {
     $keys=@{Tab=9;Enter=13;Escape=27;ArrowDown=40;ArrowUp=38;ArrowLeft=37;ArrowRight=39;Backspace=8}
     $modifier=0; $key=$a.key
     if ($key -eq 'Control+A') {$modifier=17;$vk=65} elseif ($key -eq 'Shift+Tab') {$modifier=16;$vk=9} elseif ($keys.ContainsKey($key)) {$vk=$keys[$key]} else {throw 'Unsupported key'}
     [AgentInput]::Shortcut($vk,$modifier)
    }
    {$_ -in 'fill_field','focus_field','click_element','wait_for_element'} {
     $typingReady=$false
     if ($op -in 'fill_field','focus_field' -and $a.label -eq '__focused_text_field__') {
      [AgentInput]::TypeFocused('',$h.ToInt64()); $typingFallback=$true; $typingReady=$true; $typingHandle=[AgentInput]::FocusedHandle($h.ToInt64())
      if ($op -eq 'fill_field') {[AgentInput]::TypeFocused([string]$a.value,$h.ToInt64())}; break
     }
     $root=[System.Windows.Automation.AutomationElement]::FromHandle($h)
     $condition=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,[string]$a.label)
     $matches=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,$condition)
     if ($matches.Count -ne 1) {throw 'Control is missing or ambiguous'}
     $element=$matches.Item(0)
     if ($element.Current.IsPassword -or -not $element.Current.IsEnabled -or $element.Current.IsOffscreen) {throw 'Control is protected or unavailable'}
     if ($op -in 'fill_field','focus_field') {
      $element.SetFocus()
      $pattern=$null
      if ($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$pattern)) { if ($op -eq 'focus_field') {$pattern.SetValue('')} else {$pattern.SetValue([string]$a.value)} }
      elseif ($op -eq 'fill_field') { [AgentInput]::Text([string]$a.value,$h.ToInt64()) }
      $typingElement=$element; $typingFallback=$false; $typingReady=$true; $typingHandle=[AgentInput]::FocusedHandle($h.ToInt64())
     } elseif ($op -eq 'click_element') { $pattern=$element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern); $pattern.Invoke() }
    }
    default { throw 'Unsupported desktop action' }
   }
   $result=@{ok=$true}
  }
  [Console]::WriteLine((@{id=$request.id;result=$result} | ConvertTo-Json -Depth 8 -Compress))
 } catch { [Console]::WriteLine((@{id=$request.id;error=$_.Exception.Message} | ConvertTo-Json -Compress)) }
}
