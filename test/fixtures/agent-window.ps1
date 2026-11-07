$ErrorActionPreference='Stop'
Add-Type 'using System; using System.Runtime.InteropServices; public class FixtureDpi { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int command); }'
[void][FixtureDpi]::SetProcessDPIAware()
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$form=New-Object Windows.Forms.Form
$form.Text='OpenCluely fictional input test'
$form.Size=New-Object Drawing.Size(500,240)
$form.StartPosition='CenterScreen'
$form.TopMost=$true
$field=New-Object Windows.Forms.RichTextBox
$field.AccessibleName='Test entry'
$field.Name='Test entry'
$field.Location=New-Object Drawing.Point(30,40)
$field.Width=400
$field.Height=80
$form.Controls.Add($field)
$field.Add_TextChanged({ [Console]::WriteLine((@{value=$field.Text}|ConvertTo-Json -Compress)) })
$form.Add_Shown({
 [void][FixtureDpi]::ShowWindow($form.Handle,5)
 $form.Activate(); $field.Focus()
 $point=$field.PointToScreen((New-Object Drawing.Point(30,10)))
 [Console]::WriteLine((@{handle=$form.Handle.ToInt64();x=$point.X;y=$point.Y}|ConvertTo-Json -Compress))
})
[Windows.Forms.Application]::Run($form)
