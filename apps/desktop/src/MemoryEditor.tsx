import {useState} from 'react';
import type {Bot,MemoryEntry} from '@foxbot/protocol';

export function MemoryEditor({bots,memories,save,remove}:{bots:Bot[];memories:MemoryEntry[];save:(value:Record<string,unknown>)=>Promise<unknown>;remove:(id:string)=>Promise<unknown>}) {
 const [botId,setBotId]=useState(bots[0]?.id??'');
 const [text,setText]=useState('');
 const [editing,setEditing]=useState<MemoryEntry|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const apply=async(operation:()=>Promise<unknown>)=>{setBusy(true);setError('');try{await operation();}catch(e){setError(e instanceof Error?e.message:'Could not update memory');}finally{setBusy(false);}};
 const submit=async()=>{setBusy(true);setError('');try{await save({...(editing?{id:editing.id}:{}),botId,text,enabled:editing?.enabled??true});setText('');setEditing(null);}catch(e){setError(e instanceof Error?e.message:'Could not save memory');}finally{setBusy(false);}};
 return <section aria-label="Retained memories"><div className="section-heading">Retained memories</div><p className="muted">Review the context your Bots retain. Disabled entries are excluded from future model requests.</p><label>Bot<select value={botId} onChange={e=>{setBotId(e.target.value);setEditing(null);setText('');}}>{bots.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>{memories.filter(m=>m.botId===botId).map(m=><div className="list-row" key={m.id}><div><p>{m.text}</p><span className="badge">{m.enabled?'Enabled':'Disabled'}</span></div><button onClick={()=>{setEditing(m);setText(m.text);}}>Edit</button><button disabled={busy} onClick={()=>void apply(()=>save({...m,enabled:!m.enabled}))}>{m.enabled?'Disable':'Enable'}</button><button className="danger" disabled={busy} onClick={()=>void apply(()=>remove(m.id))}>Delete</button></div>)}<form onSubmit={e=>{e.preventDefault();void submit();}}><label>{editing?'Edit memory':'Add memory'}<textarea required maxLength={200000} rows={3} value={text} onChange={e=>setText(e.target.value)}/></label><button className="primary" disabled={!botId||!text.trim()||busy}>{busy?'Saving…':'Save memory'}</button>{editing&&<button type="button" onClick={()=>{setEditing(null);setText('');}}>Cancel edit</button>}{error&&<p role="alert" className="error">{error}</p>}</form></section>;
}
