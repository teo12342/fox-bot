use serde::Deserialize;
use serde_json::{Value, json};
use std::io::{self, BufRead, Write};
use std::sync::atomic::{AtomicBool, Ordering};
static STOPPED: AtomicBool = AtomicBool::new(false);
#[derive(Deserialize)]
struct Request { id: Value, method: String, #[serde(default)] args: Value }
fn number(a:&Value,k:&str)->Result<i32,String>{a[k].as_i64().and_then(|v|i32::try_from(v).ok()).ok_or(format!("Invalid {k}"))}
fn text<'a>(a:&'a Value,k:&str)->Result<&'a str,String>{a[k].as_str().ok_or(format!("Invalid {k}"))}
fn dispatch(method:&str,args:&Value)->Result<Value,String>{
 if method=="emergency_stop" {STOPPED.store(true,Ordering::SeqCst);return Ok(json!({"stopped":true}));}
 if method=="resume" {STOPPED.store(false,Ordering::SeqCst);return Ok(json!({"stopped":false}));}
 if STOPPED.load(Ordering::SeqCst)&&matches!(method,"click"|"type"|"key"|"scroll"){return Err("Emergency stop is active".into());}
 platform::dispatch(method,args)
}
fn main(){
 let stdin=io::stdin();let mut out=io::stdout().lock();
 for line in stdin.lock().lines(){
  let response=match line {Ok(line) if line.len()<=1048576=>match serde_json::from_str::<Request>(&line){Ok(r)=>match dispatch(&r.method,&r.args){Ok(data)=>json!({"id":r.id,"ok":true,"data":data}),Err(error)=>json!({"id":r.id,"ok":false,"error":error})},Err(_)=>json!({"id":null,"ok":false,"error":"Invalid request"})},_=>json!({"id":null,"ok":false,"error":"Input too large or unreadable"})};
  if writeln!(out,"{response}").and_then(|_|out.flush()).is_err(){break;}
 }
}

#[cfg(windows)]
mod platform {
 use super::*;
 use windows::Win32::{System::Com::*,UI::{Accessibility::*,Input::KeyboardAndMouse::*,WindowsAndMessaging::*},Graphics::Gdi::*};
 fn error(e:windows::core::Error)->String{e.to_string()}
 unsafe fn inputs(events:&[INPUT])->Result<Value,String>{let n=unsafe{SendInput(events,std::mem::size_of::<INPUT>() as i32)};if n!=events.len()as u32{return Err("SendInput failed (application may be elevated or desktop locked)".into());}Ok(json!({"sent":n}))}
 fn keyboard(vk:VIRTUAL_KEY,scan:u16,flags:KEYBD_EVENT_FLAGS)->INPUT{INPUT{r#type:INPUT_KEYBOARD,Anonymous:INPUT_0{ki:KEYBDINPUT{wVk:vk,wScan:scan,dwFlags:flags,time:0,dwExtraInfo:0}}}}
 fn mouse(flags:MOUSE_EVENT_FLAGS,data:u32)->INPUT{INPUT{r#type:INPUT_MOUSE,Anonymous:INPUT_0{mi:MOUSEINPUT{dx:0,dy:0,mouseData:data,dwFlags:flags,time:0,dwExtraInfo:0}}}}
 pub fn dispatch(method:&str,args:&Value)->Result<Value,String>{unsafe{match method {
  "capabilities"=>Ok(json!({"platform":"windows","inspect":true,"click":true,"type":true,"key":true,"scroll":true,"screenshot":true,"stopped":STOPPED.load(Ordering::SeqCst),"limitations":["No elevated applications, lock screen, or secure desktop"]})),
  "click"=>{let x=number(args,"x")?;let y=number(args,"y")?;SetCursorPos(x,y).map_err(error)?;inputs(&[mouse(MOUSEEVENTF_LEFTDOWN,0),mouse(MOUSEEVENTF_LEFTUP,0)])},
  "type"=>{let s=text(args,"text")?;if s.len()>32768{return Err("Text too long".into());}let events:Vec<INPUT>=s.encode_utf16().flat_map(|c|[keyboard(VIRTUAL_KEY(0),c,KEYEVENTF_UNICODE),keyboard(VIRTUAL_KEY(0),c,KEYEVENTF_UNICODE|KEYEVENTF_KEYUP)]).collect();inputs(&events)},
  "key"=>{let vk=match text(args,"key")?.to_lowercase().as_str(){"enter"=>VK_RETURN,"tab"=>VK_TAB,"escape"=>VK_ESCAPE,"backspace"=>VK_BACK,"delete"=>VK_DELETE,"up"=>VK_UP,"down"=>VK_DOWN,"left"=>VK_LEFT,"right"=>VK_RIGHT,"space"=>VK_SPACE,"home"=>VK_HOME,"end"=>VK_END,"pageup"=>VK_PRIOR,"pagedown"=>VK_NEXT,_=>return Err("Unsupported key".into())};inputs(&[keyboard(vk,0,KEYBD_EVENT_FLAGS(0)),keyboard(vk,0,KEYEVENTF_KEYUP)])},
  "scroll"=>{let amount=number(args,"amount")?.clamp(-100,100);inputs(&[mouse(MOUSEEVENTF_WHEEL,(amount*120)as u32)])},
  "inspect"=>inspect(),
  "screenshot"=>screenshot(text(args,"path")?),
  _=>Err("Unsupported method".into())
 }}}
 unsafe fn inspect()->Result<Value,String>{unsafe{
  let initialized=CoInitializeEx(None,COINIT_MULTITHREADED).is_ok();
  let result=(||{let automation:IUIAutomation=CoCreateInstance(&CUIAutomation,None,CLSCTX_INPROC_SERVER).map_err(error)?;let root=automation.GetRootElement().map_err(error)?;let walker=automation.ControlViewWalker().map_err(error)?;let mut nodes=Vec::new();walk(&walker,&root,0,&mut nodes);Ok(json!({"elements":nodes,"limit":500}))})();
  if initialized{CoUninitialize();}result
 }}
 unsafe fn walk(walker:&IUIAutomationTreeWalker,node:&IUIAutomationElement,depth:usize,nodes:&mut Vec<Value>){unsafe{
  if depth>8||nodes.len()>=500{return;}let rect=node.CurrentBoundingRectangle().unwrap_or_default();nodes.push(json!({"name":node.CurrentName().map(|v|v.to_string()).unwrap_or_default(),"automationId":node.CurrentAutomationId().map(|v|v.to_string()).unwrap_or_default(),"controlType":node.CurrentControlType().map(|v|v.0).unwrap_or_default(),"depth":depth,"bounds":{"x":rect.left,"y":rect.top,"width":rect.right-rect.left,"height":rect.bottom-rect.top}}));
  if let Ok(mut child)=walker.GetFirstChildElement(node){loop{walk(walker,&child,depth+1,nodes);if nodes.len()>=500{break;}match walker.GetNextSiblingElement(&child){Ok(next)=>child=next,Err(_)=>break}}}
 }}
 unsafe fn screenshot(path:&str)->Result<Value,String>{unsafe{
  if !std::path::Path::new(path).is_absolute(){return Err("Screenshot path must be absolute".into());}
  let x=GetSystemMetrics(SM_XVIRTUALSCREEN);let y=GetSystemMetrics(SM_YVIRTUALSCREEN);let w=GetSystemMetrics(SM_CXVIRTUALSCREEN);let h=GetSystemMetrics(SM_CYVIRTUALSCREEN);
  if w<=0||h<=0||i64::from(w)*i64::from(h)>100_000_000{return Err("Invalid screen dimensions".into());}
  let screen=GetDC(None);if screen.is_invalid(){return Err("GetDC failed".into());}let dc=CreateCompatibleDC(Some(screen));let bitmap=CreateCompatibleBitmap(screen,w,h);
  if dc.is_invalid()||bitmap.is_invalid(){if !bitmap.is_invalid(){let _=DeleteObject(bitmap.into());}if !dc.is_invalid(){let _=DeleteDC(dc);}ReleaseDC(None,screen);return Err("GDI allocation failed".into());}
  let old=SelectObject(dc,bitmap.into());let copied=BitBlt(dc,0,0,w,h,Some(screen),x,y,SRCCOPY|CAPTUREBLT);SelectObject(dc,old);
  let mut info=BITMAPINFO::default();info.bmiHeader.biSize=std::mem::size_of::<BITMAPINFOHEADER>()as u32;info.bmiHeader.biWidth=w;info.bmiHeader.biHeight=-h;info.bmiHeader.biPlanes=1;info.bmiHeader.biBitCount=32;info.bmiHeader.biCompression=BI_RGB.0;
  let mut pixels=vec![0u8;(w as usize)*(h as usize)*4];let rows=GetDIBits(dc,bitmap,0,h as u32,Some(pixels.as_mut_ptr().cast()),&mut info,DIB_RGB_COLORS);let _=DeleteObject(bitmap.into());let _=DeleteDC(dc);ReleaseDC(None,screen);copied.map_err(error)?;if rows!=h{return Err("GetDIBits failed".into());}
  let mut bytes=Vec::with_capacity(54+pixels.len());bytes.extend(b"BM");bytes.extend(((54+pixels.len())as u32).to_le_bytes());bytes.extend([0u8;4]);bytes.extend(54u32.to_le_bytes());bytes.extend(40u32.to_le_bytes());bytes.extend(w.to_le_bytes());bytes.extend((-h).to_le_bytes());bytes.extend(1u16.to_le_bytes());bytes.extend(32u16.to_le_bytes());bytes.extend([0u8;24]);bytes.extend(pixels);std::fs::write(path,bytes).map_err(|e|e.to_string())?;Ok(json!({"path":path,"mime":"image/bmp","x":x,"y":y,"width":w,"height":h}))
 }}
}

#[cfg(target_os="linux")]
mod platform {
 use super::*;use std::process::Command;
 fn exists(name:&str)->bool{Command::new("which").arg(name).output().map(|r|r.status.success()).unwrap_or(false)}
 fn run(program:&str,args:&[&str])->Result<String,String>{let r=Command::new(program).args(args).output().map_err(|e|e.to_string())?;if !r.status.success(){return Err(String::from_utf8_lossy(&r.stderr).chars().take(4096).collect());}Ok(String::from_utf8_lossy(&r.stdout).chars().take(262144).collect())}
 pub fn dispatch(method:&str,args:&Value)->Result<Value,String>{
  let wayland=std::env::var_os("WAYLAND_DISPLAY").is_some();let x11=std::env::var_os("DISPLAY").is_some()&&!wayland;let input=x11&&exists("xdotool");
  if method=="capabilities"{let inspect=Command::new("python3").args(["-c","import pyatspi"]).output().map(|r|r.status.success()).unwrap_or(false);return Ok(json!({"platform":"linux","session":if wayland{"wayland"}else{"x11"},"click":input,"type":input,"key":input,"scroll":input,"screenshot":x11&&exists("import"),"inspect":inspect,"limitations":if wayland{vec!["Wayland portal capture/control not implemented; native launch gate remains open"]}else{vec!["Requires xdotool, ImageMagick import and python3-pyatspi; desktop AT-SPI must be enabled"]}}));}
  if matches!(method,"click"|"type"|"key"|"scroll")&&!input{return Err("Native input unavailable: requires an X11 session and xdotool; Wayland control not implemented".into());}
  match method{
   "click"=>{let x=number(args,"x")?.to_string();let y=number(args,"y")?.to_string();run("xdotool",&["mousemove","--sync",&x,&y,"click","1"])?;Ok(json!({"sent":true}))},
   "type"=>{let s=text(args,"text")?;if s.len()>32768{return Err("Text too long".into());}run("xdotool",&["type","--clearmodifiers","--",s])?;Ok(json!({"sent":true}))},
   "key"=>{let key=match text(args,"key")?.to_lowercase().as_str(){"enter"=>"Return","tab"=>"Tab","escape"=>"Escape","backspace"=>"BackSpace","delete"=>"Delete","up"=>"Up","down"=>"Down","left"=>"Left","right"=>"Right","space"=>"space","home"=>"Home","end"=>"End","pageup"=>"Prior","pagedown"=>"Next",_=>return Err("Unsupported key".into())};run("xdotool",&["key","--clearmodifiers",key])?;Ok(json!({"sent":true}))},
   "scroll"=>{let amount=number(args,"amount")?.clamp(-100,100);if amount!=0{let n=amount.abs().to_string();run("xdotool",&["click","--repeat",&n,"--delay","15",if amount>0{"4"}else{"5"}])?;}Ok(json!({"sent":true}))},
   "screenshot"=>{let path=text(args,"path")?;if !std::path::Path::new(path).is_absolute(){return Err("Screenshot path must be absolute".into());}if !x11{return Err("Wayland screenshot portal not implemented".into());}run("import",&["-window","root",path])?;Ok(json!({"path":path}))},
   "inspect"=>{let result=run("python3",&["-c",include_str!("linux_atspi.py")])?;serde_json::from_str(&result).map_err(|e|e.to_string())},
   _=>Err("Unsupported method".into())
  }
 }
}
#[cfg(not(any(windows,target_os="linux")))]
mod platform{use super::*;pub fn dispatch(_: &str,_:&Value)->Result<Value,String>{Err("Unsupported platform".into())}}
#[cfg(test)]
mod tests{use super::*;#[test]fn bounds(){assert!(number(&json!({"x":i64::MAX}),"x").is_err());assert!(text(&json!({"text":1}),"text").is_err());}#[test]fn emergency_stop_blocks_input(){dispatch("emergency_stop",&json!({})).unwrap();assert!(dispatch("click",&json!({"x":0,"y":0})).is_err());dispatch("resume",&json!({})).unwrap();}#[test]fn unknown_method(){assert!(dispatch("unknown",&json!({})).is_err());}}
