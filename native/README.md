# Fox Bot native helper

Build with stable Rust: `cargo build --release`. Windows requires MSVC build tools and Windows SDK. Linux runtime dependencies are `xdotool`, ImageMagick (`import`), and Python 3 with distro package `python3-pyatspi` on an X11 desktop with accessibility enabled. AT-SPI inspection also works independently of X11 where the accessibility bus is available. The executable is `target/release/foxbot-native.exe` on Windows or `target/release/foxbot-native` on Linux. Build separately on each OS/architecture; Linux/ARM64 compatibility is not proven by a Windows build.

The desktop starts this executable as a private child process with piped stdin/stdout. Do not expose it as a TCP or HTTP service. The desktop enforces approvals, exclusive computer ownership, verified mobile trust, and human takeover before submitting any mutation. The helper itself provides a process-wide emergency-stop latch. `resume` requires a desktop owner action, not an agent tool invocation.

Requests and replies are newline-delimited compact JSON. Request: `{id,method,args}`. Reply: `{id,ok:true,data}` or `{id,ok:false,error:"description"}`. `id` is echoed verbatim. Invalid JSON has null ID. Limit requests to 1 MiB. No informational logging is emitted on stdout.

| Method | Arguments | Result |
|---|---|---|
| capabilities | `{}` | Availability booleans, platform and limitations |
| inspect | `{}` | Up to 500 elements, depth 8, names/roles/bounds through Windows UIAutomation or Linux AT-SPI |
| screenshot | `{path:"absolute filesystem path"}` | Windows: BMP path/mime, virtual-desktop origin and size. Linux: ImageMagick writes according to extension |
| click | `{x:integer,y:integer}` | Left click at absolute desktop coordinates |
| type | `{text:string}` | Unicode text, up to 32 KiB |
| key | `{key:string}` | enter/tab/escape/backspace/delete/arrows/space/home/end/pageup/pagedown |
| scroll | `{amount:integer}` | Clamped ±100 wheel notches; positive scrolls upward |
| emergency_stop | `{}` | Latches stopped; blocks all input methods |
| resume | `{}` | Explicitly clears stopped state |

Windows screenshot captures all monitors using GDI and requires a writable caller-supplied absolute path. Secure/elevated desktops may reject SendInput; errors are returned. Accessibility names can contain private application data and must remain local unless the owner deliberately requests remote viewing. Password fields are not read as values.

**Remaining native launch gates:** Wayland ScreenCast/RemoteDesktop portal sessions are not implemented; capabilities return native input/capture unavailable. Linux backends, Windows ARM64, and display-scale/monitor edge cases require platform testing. Do not advertise full certified Linux control until these gates pass.

Run `cargo test` for argument validation and stop-latch behavior. Safe Windows smoke checks can submit capabilities, inspect, and screenshot; automated tests must not type or click into the user's active applications. The helper is synchronous: emergency stop prevents subsequent requests but cannot interrupt a tool call already blocked inside an OS API. The supervising desktop should terminate the helper if an OS call exceeds its deadline.
