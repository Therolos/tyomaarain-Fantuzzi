import { useState, useEffect } from "react";
import { collection, doc, onSnapshot, setDoc, deleteDoc, getDoc } from "firebase/firestore";
import { db } from "./firebase";

const DEF_KONEET  = ["Fantuzzi RS45","Fantuzzi FCS80","Fantuzzi TFC","Liebherr LHM","Kalmar DRF","Muu kone"];
const DEF_TEKIJAT = ["Jallu","Matti","Pekka","Juha","Ville"];

const WO_STATUS = [
  { id:"avoin",   label:"Avoin",        c:"#d97706" },
  { id:"kesken",  label:"Kesken",       c:"#2563eb" },
  { id:"valmis",  label:"Valmis",       c:"#16a34a" },
  { id:"odottaa", label:"Odottaa osia", c:"#dc2626" },
];
const KS_STATUS = [
  { id:"ok",       label:"Toimintakunnossa", c:"#16a34a", icon:"✅" },
  { id:"huolto",   label:"Huollossa",        c:"#d97706", icon:"🔧" },
  { id:"rikki",    label:"Vikatila",         c:"#dc2626", icon:"🚨" },
  { id:"odottaa",  label:"Odottaa osia",     c:"#7c3aed", icon:"📦" },
  { id:"seisokki", label:"Seisokki",         c:"#6b7280", icon:"⏸"  },
];

const uid = () => "TM-" + Date.now().toString().slice(-6);
const pdfStr = s => String(s||"")
  .replace(/ä/g,"a").replace(/Ä/g,"A")
  .replace(/ö/g,"o").replace(/Ö/g,"O")
  .replace(/å/g,"a").replace(/Å/g,"A");
const fd  = iso => iso ? new Date(iso).toLocaleDateString("fi-FI",{day:"2-digit",month:"2-digit",year:"numeric"}) : "-";
const ft  = iso => iso ? new Date(iso).toLocaleTimeString("fi-FI",{hour:"2-digit",minute:"2-digit"}) : "";
const wos = id  => WO_STATUS.find(s=>s.id===id) || WO_STATUS[0];
const kss = id  => KS_STATUS.find(s=>s.id===id) || KS_STATUS[0];

// ── Tuntirakenne helpers ──────────────────────────────────────────────────────
// Uusi rakenne: { "Jallu": [{h:3, pvm:"2025-05-07"}, {h:2, pvm:"2025-05-08"}] }
// Vanha rakenne: { "Jallu": 3 }  <- yhteensopivuus

function normalizeTunnit(tt) {
  // Muuntaa vanhan rakenteen uuteen
  if (!tt) return {};
  const result = {};
  for (const [k, v] of Object.entries(tt)) {
    if (Array.isArray(v)) result[k] = v;
    else result[k] = [{h: Number(v)||0, pvm: ""}];
  }
  return result;
}

function sumTekija(rivit) {
  if (!rivit) return 0;
  if (Array.isArray(rivit)) return rivit.reduce((a,r)=>a+Number(r.h||0),0);
  return Number(rivit)||0;
}

function sumH(m) {
  if (!m.tekijaTunnit) return Number(m.tunnit||0);
  return Object.values(m.tekijaTunnit).reduce((a,v)=>a+sumTekija(v),0);
}

function tekijatListaus(m) {
  if (!m.tekijaTunnit) return "";
  const norm = normalizeTunnit(m.tekijaTunnit);
  return Object.entries(norm).map(([k,rivit])=>`${k} ${sumTekija(rivit)}h`).join(", ");
}

// ── PDF ───────────────────────────────────────────────────────────────────────
async function doPDF(m) {
  await new Promise(res => {
    if (window.jspdf) { res(); return; }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    s.onload = res; document.head.appendChild(s);
  });
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({unit:"mm",format:"a4"});
  const W=210, L=20;
  doc.setFillColor(217,119,6); doc.rect(0,0,W,22,"F");
  doc.setTextColor(255,255,255); doc.setFont("helvetica","bold");
  doc.setFontSize(14); doc.text("FANTUZZI FINLAND OY", L, 10);
  doc.setFontSize(9);  doc.text("TYOMAARAIN", L, 17);
  doc.setFontSize(11); doc.text(m.id, W-L, 10, {align:"right"});
  doc.setFontSize(8);  doc.text(wos(m.status).label.toUpperCase(), W-L, 17, {align:"right"});
  let y=34;
  const row=(lbl,val,bold=false)=>{
    doc.setFont("helvetica","normal"); doc.setFontSize(7); doc.setTextColor(120,120,120);
    doc.text(pdfStr(lbl).toUpperCase(), L, y);
    doc.setFont("helvetica",bold?"bold":"normal"); doc.setFontSize(10); doc.setTextColor(20,20,20);
    const lines=doc.splitTextToSize(pdfStr(val||"-"),W-L*2);
    doc.text(lines,L,y+5); y+=6+lines.length*5+4;
    doc.setDrawColor(220,220,220); doc.line(L,y-2,W-L,y-2);
  };
  row("Kone / Laite", pdfStr(m.kone), true);
  if (m.tekijaTunnit) {
    const norm = normalizeTunnit(m.tekijaTunnit);
    Object.entries(norm).forEach(([tekija,rivit])=>{
      const detail = rivit.map(r=>`${r.pvm?fd(r.pvm):"?"} ${r.h}h`).join(", ");
      row(`${pdfStr(tekija)} (${sumTekija(rivit)}h yht.)`, pdfStr(detail));
    });
  }
  row("Konetunnit (mittarilukema)", (m.konetunnit||"?") + " h");
  row("Paivamaara", fd(m.pvm));
  row("Mita tehty", pdfStr(m.kuvaus));
  if (m.lisatiedot) row("Lisatiedot", pdfStr(m.lisatiedot));
  doc.setFont("helvetica","normal"); doc.setFontSize(7); doc.setTextColor(160,160,160);
  doc.text("Tulostettu: "+fd(new Date().toISOString())+"  |  Fantuzzi Finland Oy", L, 285);
  doc.save(`${pdfStr(m.kone)}_${fd(m.pvm).replace(/\./g,"-")}_${m.id}.pdf`);
}

// ── CSV ───────────────────────────────────────────────────────────────────────
function doCSV(list) {
  const tlist=[...new Set(list.flatMap(m=>m.tekijaTunnit?Object.keys(m.tekijaTunnit):[]))].sort();
  const H=["ID","Kone","Päivämäärä","Konetunnit (h)","Työtunnit yht.","Status","Kuvaus","Lisätiedot","Luotu",...tlist.map(t=>t+" (h)")];
  const rows=list.map(m=>{
    const r=[m.id,m.kone,fd(m.pvm),(m.konetunnit||""),sumH(m),wos(m.status).label,
      '"'+(m.kuvaus||"").replace(/"/g,'""')+'"','"'+(m.lisatiedot||"").replace(/"/g,'""')+'"',fd(m.luotu)];
    tlist.forEach(t=>{
      const norm=normalizeTunnit(m.tekijaTunnit||{});
      r.push(norm[t]?sumTekija(norm[t]):"");
    });
    return r;
  });
  const csv="\uFEFF"+[H,...rows].map(r=>r.join(";")).join("\n");
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8;"}));
  a.download="tyomaaraimet_"+new Date().toISOString().slice(0,10)+".csv";
  a.click();
}

// ── Firestore helpers ─────────────────────────────────────────────────────────
async function loadSettings() {
  try { const s=await getDoc(doc(db,"asetukset","data")); if(s.exists()) return s.data(); } catch {}
  return null;
}
async function saveSettings(data) {
  try { await setDoc(doc(db,"asetukset","data"),data); } catch(e){console.error(e);}
}

// ── Root App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [view,    setView]    = useState("list");
  const [woList,  setWoList]  = useState([]);
  const [koneet,  setKoneet]  = useState(DEF_KONEET);
  const [tekijat, setTekijat] = useState(DEF_TEKIJAT);
  const [kstat,   setKstat]   = useState({});
  const [sel,     setSel]     = useState(null);
  const [haku,    setHaku]    = useState("");
  const [filt,    setFilt]    = useState("active");
  const [prevView, setPrevView] = useState("list");
  const [loading, setLoading] = useState(true);

  useEffect(()=>{
    const unsub=onSnapshot(collection(db,"tyomaaraimet"),snap=>{
      const data=snap.docs.map(d=>({...d.data(),id:d.id}));
      data.sort((a,b)=>new Date(b.luotu)-new Date(a.luotu));
      setWoList(data); setLoading(false);
    },err=>{console.error(err);setLoading(false);});
    return ()=>unsub();
  },[]);

  useEffect(()=>{
    const unsub=onSnapshot(doc(db,"asetukset","konestatus"),snap=>{
      if(snap.exists()) setKstat(snap.data());
    });
    return ()=>unsub();
  },[]);

  useEffect(()=>{
    loadSettings().then(s=>{
      if(s?.koneet) setKoneet(s.koneet);
      if(s?.tekijat) setTekijat(s.tekijat);
    });
  },[]);

  const saveKoneetTekijat = async (k,t) => {
    setKoneet(k); setTekijat(t);
    await saveSettings({koneet:k,tekijat:t});
  };

  const addWO = async (data, addKone) => {
    const id=uid();
    try { await setDoc(doc(db,"tyomaaraimet",id),{...data,id,luotu:new Date().toISOString()}); }
    catch(e){console.error(e);}
    if(addKone&&!koneet.includes(addKone)){
      const next=[...koneet.filter(k=>k!=="Muu kone"),addKone,"Muu kone"];
      await saveKoneetTekijat(next,tekijat);
    }
    setView("list");
  };

  const updateWO = async (id, data) => {
    try {
      const ref=doc(db,"tyomaaraimet",id);
      const snap=await getDoc(ref);
      if(snap.exists()) await setDoc(ref,{...snap.data(),...data,muokattu:new Date().toISOString()});
    } catch(e){console.error(e);}
    setSel(s=>s?.id===id?{...s,...data,muokattu:new Date().toISOString()}:s);
    setView("detail");
  };

  const setWOStatus = async (id,status) => {
    try {
      const ref=doc(db,"tyomaaraimet",id);
      const snap=await getDoc(ref);
      if(snap.exists()) await setDoc(ref,{...snap.data(),status});
    } catch(e){console.error(e);}
    setSel(s=>s?.id===id?{...s,status}:s);
  };

  const setLappuTehty = async (id, val) => {
    try {
      const ref=doc(db,"tyomaaraimet",id);
      const snap=await getDoc(ref);
      if(snap.exists()) await setDoc(ref,{...snap.data(),lappuTehty:val});
    } catch(e){console.error(e);}
    setSel(s=>s?.id===id?{...s,lappuTehty:val}:s);
  };

  const deleteWO = async id => {
    try { await deleteDoc(doc(db,"tyomaaraimet",id)); } catch(e){console.error(e);}
    setView("list"); setSel(null);
  };

  const setKoneStatus = async (kone,sid,note) => {
    const next={...kstat,[kone]:{status:sid,note,ts:new Date().toISOString()}};
    setKstat(next);
    try { await setDoc(doc(db,"asetukset","konestatus"),next); } catch(e){console.error(e);}
  };

  const filtered=woList
    .filter(w=>{
      if(haku) return true; // haku hakee kaikista
      return filt==="active"?(w.status!=="valmis"||(w.status==="valmis"&&!w.lappuTehty)):filt==="all"||w.status===filt;
    })
    .filter(w=>{
      if(!haku) return true;
      const h=haku.toLowerCase();
      const ts=w.tekijaTunnit?Object.keys(w.tekijaTunnit).join(" "):"";
      return [w.kone,ts,w.kuvaus,w.id].some(x=>x?.toLowerCase().includes(h));
    });

  const totalH=woList.reduce((a,w)=>a+sumH(w),0);

  if(loading) return(
    <div style={{...R.root,display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh"}}>
      <div style={{textAlign:"center",color:"#9ca3af"}}><div style={{fontSize:32,marginBottom:8}}>⚙</div><div>Ladataan...</div></div>
    </div>
  );

  if(view==="arkisto") return <Arkisto woList={woList.filter(w=>w.status==="valmis"&&w.lappuTehty)} onSelect={w=>{setSel(w);setView("detail");}} onBack={()=>setView("list")}/>;
  if(view==="new")    return <NewForm koneet={koneet} tekijat={tekijat} woList={woList} onSave={addWO} onBack={()=>setView("list")}/>;
  if(view==="detail"&&sel) return <Detail w={sel} onBack={()=>setView("list")} onStatus={s=>setWOStatus(sel.id,s)} onDelete={()=>deleteWO(sel.id)} onEdit={()=>setView("edit")} onLappu={v=>setLappuTehty(sel.id,v)}/>;
  if(view==="edit"&&sel)   return <EditForm w={sel} koneet={koneet} tekijat={tekijat} woList={woList} onSave={data=>updateWO(sel.id,data)} onBack={()=>setView("detail")}/>;
  if(view==="settings") return <Settings koneet={koneet} tekijat={tekijat} onSave={saveKoneetTekijat} onBack={()=>setView("list")}/>;

  return (
    <div style={R.root}>
      <div style={R.header}>
        <div style={R.htop}>
          <div><div style={R.logo}>⚙ FANTUZZI</div><div style={R.sub}>Työmääräinjärjestelmä</div></div>
          <div style={{display:"flex",gap:6}}>
            <Btn icon onClick={()=>setView("settings")}>⚙</Btn>
            <Btn icon onClick={()=>setView("arkisto")}>📦</Btn>
            <Btn primary onClick={()=>setView("new")}>+ UUSI</Btn>
          </div>
        </div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>
          <div onClick={()=>setFilt("active")}
            style={{...R.chip,borderColor:"#d97706",background:filt==="active"?"#d97706"+"22":"transparent",cursor:"pointer"}}>
            <span style={{color:"#d97706",fontWeight:700,fontSize:11}}>{woList.filter(w=>w.status!=="valmis").length}</span>
            <span style={{color:"#999",fontSize:9,marginLeft:4}}>AKTIIVISET</span>
          </div>
          {WO_STATUS.filter(s=>s.id!=="valmis").map(s=>(
            <div key={s.id} onClick={()=>setFilt(filt===s.id?"active":s.id)}
              style={{...R.chip,borderColor:s.c,background:filt===s.id?s.c+"22":"transparent",cursor:"pointer"}}>
              <span style={{color:s.c,fontWeight:700,fontSize:11}}>{woList.filter(w=>w.status===s.id).length}</span>
              <span style={{color:"#999",fontSize:9,marginLeft:4}}>{s.label.toUpperCase()}</span>
            </div>
          ))}
        </div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontSize:11,color:"#aaa"}}>{woList.length} kpl · {totalH} h</span>
          <button style={R.csvBtn} onClick={()=>doCSV(woList)}>↓ CSV</button>
        </div>
      </div>
      <div style={R.body}>
        <input style={R.search} placeholder="🔍  Hae..." value={haku} onChange={e=>setHaku(e.target.value)}/>
        {filtered.length===0&&<div style={{textAlign:"center",marginTop:60,color:"#bbb"}}>🔧<br/>Ei työmääräimiä</div>}
        {filtered.map(w=>{
          const s=wos(w.status);
          const ts=tekijatListaus(w);
          return(
            <div key={w.id} style={{...R.card,borderLeft:w.status==="valmis"&&!w.lappuTehty?"4px solid #f59e0b":undefined}} onClick={()=>{setSel(w);setView("detail");}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                <span style={{fontSize:10,color:"#d97706",fontWeight:700,letterSpacing:2}}>{w.id}</span>
                <span style={{...R.badge,background:s.c+"18",color:s.c,border:`1px solid ${s.c}44`}}>{w.status==="valmis"&&!w.lappuTehty?"📝 Lappu tekemättä":s.label}</span>
              </div>
              <div style={{fontWeight:700,fontSize:16,color:"#111827",marginBottom:4}}>{w.kone}</div>
              <div style={{fontSize:14,color:"#6b7280",marginBottom:8,overflow:"hidden",textOverflow:"ellipsis",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>{w.kuvaus}</div>
              <div style={{display:"flex",gap:12,fontSize:13,color:"#9ca3af",flexWrap:"wrap"}}>
                {ts&&<span>👤 {ts}</span>}
                <span>🔢 {w.konetunnit||"?"}h</span>
                <span>⏱ {sumH(w)}h</span>
                <span>📅 {fd(w.pvm)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Detail ────────────────────────────────────────────────────────────────────
function Detail({w, onBack, onStatus, onDelete, onEdit, onLappu}) {
  const [pdf,  setPdf]  = useState(false);
  const [conf, setConf] = useState(false);
  const s    = wos(w.status);
  const norm = normalizeTunnit(w.tekijaTunnit||{});
  const tot  = sumH(w);

  return(
    <div style={R.root}>
      <div style={R.header}>
        <div style={R.htop}>
          <div style={R.logo}>{w.id}</div>
          <div style={{display:"flex",gap:6}}>
            <Btn onClick={onEdit}>✏ Muokkaa</Btn>
            <Btn onClick={onBack}>← Takaisin</Btn>
          </div>
        </div>
      </div>
      <div style={R.body}>
        <div style={R.card}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
            <div style={{fontWeight:700,fontSize:18,color:"#111827"}}>{w.kone}</div>
            <span style={{...R.badge,background:s.c+"18",color:s.c,border:`1px solid ${s.c}44`}}>{s.label}</span>
          </div>
          <Sec label={w.status==="avoin"?"HUOLLON SYY / TEHTÄVÄ":"MITÄ TEHTY"}>{w.kuvaus}</Sec>
          {w.lisatiedot&&<Sec label="LISÄTIEDOT / OSAT">{w.lisatiedot}</Sec>}

          {/* Tunti-erittely per tekijä */}
          <div style={R.lbl}>TEKIJÄT & TYÖTUNNIT</div>
          <div style={R.tbox}>
            {Object.entries(norm).map(([tekija,rivit])=>(
              <div key={tekija} style={{marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                  <span style={{fontSize:13,fontWeight:700,color:"#374151"}}>👤 {tekija}</span>
                  <span style={{fontWeight:700,color:"#d97706"}}>{sumTekija(rivit)} h yht.</span>
                </div>
                {rivit.filter(r=>Number(r.h)>0).map((r,i)=>(
                  <div key={i} style={{display:"flex",justifyContent:"space-between",paddingLeft:20,fontSize:12,color:"#6b7280",marginBottom:2}}>
                    <span>📅 {r.pvm?fd(r.pvm):"?"}</span>
                    <span>{r.h} h</span>
                  </div>
                ))}
              </div>
            ))}
            {Object.keys(norm).length>1&&(
              <div style={{display:"flex",justifyContent:"space-between",borderTop:"1px solid #e5e7eb",paddingTop:8,marginTop:4}}>
                <span style={{fontSize:13,color:"#9ca3af"}}>Yhteensä kaikki</span>
                <span style={{fontWeight:700,color:"#d97706",fontSize:20}}>{tot} h</span>
              </div>
            )}
          </div>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,margin:"16px 0"}}>
            <div><div style={R.lbl}>PÄIVÄMÄÄRÄ</div><div style={{fontSize:13,color:"#374151"}}>{fd(w.pvm)}</div></div>
            <div><div style={R.lbl}>KONETUNNIT</div><div style={{fontSize:18,fontWeight:700,color:"#d97706"}}>{w.konetunnit||"-"} h</div></div>
            <div><div style={R.lbl}>LUOTU</div><div style={{fontSize:13,color:"#374151"}}>{fd(w.luotu)}</div></div>
          </div>
          {w.muokattu&&<div style={{fontSize:10,color:"#9ca3af",marginBottom:16}}>Muokattu: {fd(w.muokattu)} {ft(w.muokattu)}</div>}

          <div style={R.lbl}>VAIHDA STATUS</div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",margin:"8px 0 20px"}}>
            {WO_STATUS.map(s=>(
              <button key={s.id} onClick={()=>onStatus(s.id)}
                style={{...R.stBtn,borderColor:s.c,background:w.status===s.id?s.c:"transparent",color:w.status===s.id?"#fff":s.c}}>
                {s.label}
              </button>
            ))}
          </div>

          <button style={R.pdfBtn} onClick={async()=>{setPdf(true);try{await doPDF(w);}finally{setPdf(false);}}} disabled={pdf}>
            {pdf?"⏳ Luodaan...":"📄 VIE PDF"}
          </button>
          <button style={{...R.pdfBtn,borderColor:"#d97706",color:"#d97706",marginBottom:8}} onClick={onEdit}>✏ MUOKKAA</button>
          {w.status==="valmis"&&(
            <button
              style={{...R.pdfBtn,
                borderColor:w.lappuTehty?"#16a34a":"#f59e0b",
                color:w.lappuTehty?"#16a34a":"#f59e0b",
                marginBottom:8}}
              onClick={()=>onLappu(!w.lappuTehty)}>
              {w.lappuTehty?"✅ PAPERINEN LAPPU TEHTY":"📝 MERKITSE LAPPU TEHDYKSI"}
            </button>
          )}

          {!conf
            ?<button style={R.delBtn} onClick={()=>setConf(true)}>🗑 Poista työmääräin</button>
            :<div style={{marginTop:12}}>
              <div style={{color:"#dc2626",fontSize:13,marginBottom:8}}>Poistetaanko varmasti?</div>
              <div style={{display:"flex",gap:8}}>
                <button style={{...R.stBtn,borderColor:"#dc2626",color:"#dc2626"}} onClick={onDelete}>Kyllä</button>
                <button style={{...R.stBtn,borderColor:"#e5e7eb",color:"#9ca3af"}} onClick={()=>setConf(false)}>Peruuta</button>
              </div>
            </div>}
        </div>
      </div>
    </div>
  );
}

// ── NewForm ───────────────────────────────────────────────────────────────────
function NewForm({koneet, tekijat, woList, onSave, onBack}) {
  const today=new Date().toISOString().slice(0,10);
  const [kone,       setKone]       = useState(koneet[0]||"");
  const [muuNimi,    setMuuNimi]    = useState("");
  const [ttmap,      setTtmap]      = useState({});
  const [pvm,        setPvm]        = useState(today);
  const [konetunnit, setKonetunnit] = useState("");
  const [kuvaus,     setKuvaus]     = useState("");
  const [lisat,      setLisat]      = useState("");
  const [status,     setStatus]     = useState("avoin");
  const [kysy,       setKysy]       = useState(false);
  const [saving,     setSaving]     = useState(false);

  const isMuu  = kone==="Muu kone";
  const kNimi  = isMuu?muuNimi.trim():kone;
  const kuvausSugg = [...new Set((woList||[]).map(w=>w.kuvaus).filter(Boolean))];
  const lisatSugg  = [...new Set((woList||[]).map(w=>w.lisatiedot).filter(Boolean))];
  const valitut= Object.keys(ttmap);
  const valid  = kuvaus.trim()
    &&(status==="avoin"||(valitut.length>0&&valitut.every(t=>Number(ttmap[t])>0)))
    &&(status==="avoin"||Number(konetunnit)>0)
    &&(!isMuu||muuNimi.trim());

  const toggleT = t=>setTtmap(m=>{const n={...m};if(n[t]!==undefined)delete n[t];else n[t]="";return n;});
  const setT    = (t,v)=>setTtmap(m=>({...m,[t]:v}));

  const buildTekijaTunnit = () => {
    const result={};
    valitut.forEach(t=>{ result[t]=[{h:Number(ttmap[t]),pvm}]; });
    return result;
  };

  const handleSave = async (addKone) => {
    setSaving(true);
    await onSave({kone:kNimi,tekijaTunnit:buildTekijaTunnit(),pvm,konetunnit,kuvaus,lisatiedot:lisat,status},addKone||null);
  };

  const handleTallenna = ()=>{
    if(!valid) return;
    if(isMuu&&muuNimi.trim()&&!koneet.includes(muuNimi.trim())){setKysy(true);return;}
    handleSave(null);
  };

  if(kysy) return(
    <div style={R.root}>
      <div style={R.header}><div style={R.htop}><div style={R.logo}>UUSI TYÖMÄÄRÄIN</div><Btn onClick={onBack}>← Takaisin</Btn></div></div>
      <div style={R.body}>
        <div style={{...R.card,background:"#fffbeb",border:"1px solid #fde68a"}}>
          <div style={{fontWeight:700,fontSize:14,color:"#1f2937",marginBottom:8}}>Lisätäänkö "{muuNimi.trim()}" konelistan?</div>
          <div style={{fontSize:12,color:"#9ca3af",marginBottom:16}}>Kone löytyy jatkossa suoraan valikosta</div>
          <div style={{display:"flex",gap:8}}>
            <Btn primary onClick={()=>handleSave(kNimi)} disabled={saving}>✓ Kyllä, lisää</Btn>
            <Btn onClick={()=>handleSave(null)} disabled={saving}>Ei, kertatyö</Btn>
          </div>
        </div>
      </div>
    </div>
  );

  return(
    <div style={R.root}>
      <div style={R.header}><div style={R.htop}><div style={R.logo}>UUSI TYÖMÄÄRÄIN</div><Btn onClick={onBack}>← Takaisin</Btn></div></div>
      <div style={R.body}>
        <Label>KONE / LAITE</Label>
        <select style={R.input} value={kone} onChange={e=>{setKone(e.target.value);setKysy(false);}}>
          {koneet.map(k=><option key={k}>{k}</option>)}
        </select>
        {isMuu&&<>
          <input style={{...R.input,borderColor:muuNimi.trim()?"#d97706":"#e5e7eb"}}
            placeholder="Kirjoita koneen nimi..." value={muuNimi} onChange={e=>setMuuNimi(e.target.value)}/>
          {!muuNimi.trim()&&<Hint>Syötä koneen nimi</Hint>}
        </>}

        <Label>TEKIJÄT & TYÖTUNNIT {status==="avoin"?"(vapaaehtoinen)":"*"}</Label>
        <TekijaValinta tekijat={tekijat} ttmap={ttmap} toggleT={toggleT} setT={setT} pvm={pvm}/>

        <Label>KONETUNNIT / MITTARILUKEMA (h) *</Label>
        <input style={R.input} type="number" min="0" step="1" placeholder={status==="avoin"?"esim. 1250 (vapaaehtoinen)":"esim. 1250"}
          value={konetunnit} onChange={e=>setKonetunnit(e.target.value)}/>

        <Label>PÄIVÄMÄÄRÄ</Label>
        <input style={R.input} type="date" value={pvm} onChange={e=>setPvm(e.target.value)}/>

        <Label>{status==="avoin"?"HUOLLON SYY / TEHTÄVÄ *":"MITÄ TEHTY *"}</Label>
        <AutoField style={{...R.input,height:80,resize:"none"}} rows
          placeholder={status==="avoin"?"Kuvaa tuleva huolto / vika...":"Kuvaa tehdyt työt..."}
          value={kuvaus} onChange={setKuvaus} suggestions={kuvausSugg}/>

        <Label>LISÄTIEDOT / OSAT</Label>
        <AutoField style={{...R.input,height:60,resize:"none"}} rows
          placeholder="Vaihdetut osat, huomiot..."
          value={lisat} onChange={setLisat} suggestions={lisatSugg}/>

        <Label>STATUS</Label>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:24}}>
          {WO_STATUS.map(s=>(
            <button key={s.id} onClick={()=>setStatus(s.id)}
              style={{...R.stBtn,borderColor:s.c,background:status===s.id?s.c:"transparent",color:status===s.id?"#fff":s.c}}>
              {s.label}
            </button>
          ))}
        </div>
        {!valid&&valitut.length>0&&<Hint red>Tarkista tekijöiden tunnit{status!=="avoin"?" ja mittarilukema":""}</Hint>}
        <Btn primary full disabled={!valid||saving} onClick={handleTallenna}>
          {saving?"⏳ Tallennetaan...":"💾 TALLENNA TYÖMÄÄRÄIN"}
        </Btn>
      </div>
    </div>
  );
}

// ── EditForm — lisää tunnit olemassaolevaan TM:ään ────────────────────────────
function EditForm({w, koneet, tekijat, woList, onSave, onBack}) {
  const today=new Date().toISOString().slice(0,10);
  // Uudet tunnit jotka lisätään
  const [ttmap,      setTtmap]      = useState({});
  const [pvmUusi,    setPvmUusi]    = useState(today);
  const [konetunnit, setKonetunnit] = useState(w.konetunnit||"");
  const [kuvaus,     setKuvaus]     = useState(w.kuvaus||"");
  const [lisat,      setLisat]      = useState(w.lisatiedot||"");
  const [status,     setStatus]     = useState(w.status||"avoin");
  const [saving,     setSaving]     = useState(false);
  const [editNorm,   setEditNorm]   = useState(normalizeTunnit(w.tekijaTunnit||{}));

  const valitut=Object.keys(ttmap);
  const kuvausSugg = [...new Set((woList||[]).map(w=>w.kuvaus).filter(Boolean))];
  const lisatSugg  = [...new Set((woList||[]).map(w=>w.lisatiedot).filter(Boolean))];
  // Valid: joko lisätään tunnit TAI pelkkä kuvaus/status muutos
  const validTunnit = valitut.length===0 || valitut.every(t=>Number(ttmap[t])>0);
  const valid = kuvaus.trim() && (status==="avoin"||Number(konetunnit)>0) && (status==="avoin"||validTunnit);

  const toggleT = t=>setTtmap(m=>{const n={...m};if(n[t]!==undefined)delete n[t];else n[t]="";return n;});
  const setT    = (t,v)=>setTtmap(m=>({...m,[t]:v}));

  const handleSave = async () => {
    setSaving(true);
    // Käytetään editNorm (muokatut vanhat) + uudet tunnit
    const norm = {};
    // Kopioi muokatut vanhat, suodata 0h pois
    Object.entries(editNorm).forEach(([t,rivit])=>{
      const filtered = rivit.filter(r=>Number(r.h)>0);
      if(filtered.length>0) norm[t] = filtered;
    });
    // Lisää uudet tunnit
    valitut.forEach(t=>{
      const h=Number(ttmap[t]);
      if(h<=0) return;
      const uusiRivi={h,pvm:pvmUusi};
      if(norm[t]) norm[t]=[...norm[t],uusiRivi];
      else norm[t]=[uusiRivi];
    });
    await onSave({
      tekijaTunnit: norm,
      konetunnit,
      kuvaus,
      lisatiedot: lisat,
      status,
    });
  };

  return(
    <div style={R.root}>
      <div style={R.header}>
        <div style={R.htop}>
          <div style={R.logo}>✏ MUOKKAA {w.id}</div>
          <Btn onClick={onBack}>← Takaisin</Btn>
        </div>
      </div>
      <div style={R.body}>
        {/* Näytä olemassaolevat tunnit */}
        {Object.keys(editNorm).length>0&&(
          <>
            <div style={R.lbl}>AIEMMAT TUNNIT (muokattavissa)</div>
            <div style={{...R.tbox,marginBottom:16}}>
              {Object.entries(editNorm).map(([tekija,rivit])=>(
                <div key={tekija} style={{marginBottom:12}}>
                  <div style={{fontSize:13,fontWeight:700,color:"#374151",marginBottom:6}}>
                    👤 {tekija} — {rivit.reduce((a,r)=>a+Number(r.h||0),0)} h yht.
                  </div>
                  {rivit.map((r,i)=>(
                    <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",paddingLeft:12,marginBottom:6,gap:8}}>
                      <span style={{fontSize:12,color:"#6b7280"}}>📅 {r.pvm?fd(r.pvm):"?"}</span>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <input
                          style={{...R.input,width:70,marginBottom:0,textAlign:"right",fontSize:13}}
                          type="number" min="0" step="0.5"
                          value={r.h}
                          onChange={e=>{
                            setEditNorm(prev=>{
                              const next={...prev};
                              next[tekija]=next[tekija].map((x,j)=>j===i?{...x,h:e.target.value}:x);
                              return next;
                            });
                          }}
                        />
                        <span style={{color:"#9ca3af",fontSize:12}}>h</span>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
              <div style={{display:"flex",justifyContent:"space-between",borderTop:"1px solid #e5e7eb",paddingTop:8,marginTop:4}}>
                <span style={{fontSize:12,color:"#9ca3af"}}>Yhteensä tähän asti</span>
                <span style={{fontWeight:700,color:"#d97706"}}>
                  {Object.values(editNorm).reduce((a,rivit)=>a+rivit.reduce((b,r)=>b+Number(r.h||0),0),0)} h
                </span>
              </div>
            </div>
            <div style={{fontSize:10,color:"#9ca3af",marginBottom:12}}>💡 Aseta 0 jos haluat poistaa rivin</div>
          </>
        )}

        {/* Lisää uusia tunteja */}
        <Label>LISÄÄ TUNNIT (vapaaehtoinen)</Label>
        <div style={{fontSize:11,color:"#9ca3af",marginBottom:8}}>Valitse tekijät joille lisätään tunteja tältä päivältä</div>

        <Label>PÄIVÄMÄÄRÄ LISÄTYILLE TUNNEILLE</Label>
        <input style={R.input} type="date" value={pvmUusi} onChange={e=>setPvmUusi(e.target.value)}/>

        <TekijaValinta tekijat={tekijat} ttmap={ttmap} toggleT={toggleT} setT={setT} pvm={pvmUusi}/>

        <Label>KONETUNNIT / MITTARILUKEMA (h) *</Label>
        <input style={R.input} type="number" min="0" step="1" placeholder={status==="avoin"?"esim. 1250 (vapaaehtoinen)":"esim. 1250"}
          value={konetunnit} onChange={e=>setKonetunnit(e.target.value)}/>

        <Label>{status==="avoin"?"HUOLLON SYY / TEHTÄVÄ *":"MITÄ TEHTY *"}</Label>
        <textarea style={{...R.input,height:80,resize:"none"}} placeholder={status==="avoin"?"Kuvaa tuleva huolto / vika...":"Kuvaa tehdyt työt..."}
          value={kuvaus} onChange={e=>setKuvaus(e.target.value)}/>

        <Label>LISÄTIEDOT / OSAT</Label>
        <textarea style={{...R.input,height:60,resize:"none"}}
          value={lisat} onChange={e=>setLisat(e.target.value)}/>

        <Label>STATUS</Label>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:24}}>
          {WO_STATUS.map(s=>(
            <button key={s.id} onClick={()=>setStatus(s.id)}
              style={{...R.stBtn,borderColor:s.c,background:status===s.id?s.c:"transparent",color:status===s.id?"#fff":s.c}}>
              {s.label}
            </button>
          ))}
        </div>
        <Btn primary full disabled={!valid||saving} onClick={handleSave}>
          {saving?"⏳ Tallennetaan...":"💾 TALLENNA MUUTOKSET"}
        </Btn>
      </div>
    </div>
  );
}

// ── TekijaValinta — yhteinen komponentti ──────────────────────────────────────
function TekijaValinta({tekijat, ttmap, toggleT, setT}) {
  const valitut=Object.keys(ttmap);
  return(
    <>
      <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:10}}>
        {tekijat.map(t=>{
          const on=ttmap[t]!==undefined;
          return <button key={t} onClick={()=>toggleT(t)}
            style={{...R.stBtn,borderColor:on?"#d97706":"#e5e7eb",background:on?"#d97706":"transparent",color:on?"#fff":"#6b7280"}}>
            {on?"✓ ":""}{t}
          </button>;
        })}
      </div>
      {valitut.length>0&&(
        <div style={R.tbox}>
          {valitut.map(t=>(
            <div key={t} style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <span style={{fontSize:13,color:"#374151"}}>👤 {t}</span>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <input style={{...R.input,width:80,marginBottom:0,textAlign:"right"}}
                  type="number" min="0.5" step="0.5" placeholder="0"
                  value={ttmap[t]} onChange={e=>setT(t,e.target.value)}/>
                <span style={{color:"#9ca3af",fontSize:12}}>h</span>
              </div>
            </div>
          ))}
          {valitut.length>1&&(
            <div style={{display:"flex",justifyContent:"space-between",borderTop:"1px solid #e5e7eb",paddingTop:8,marginTop:4}}>
              <span style={{fontSize:13,color:"#9ca3af"}}>Yhteensä</span>
              <span style={{fontWeight:700,color:"#d97706"}}>{valitut.reduce((a,t)=>a+Number(ttmap[t]||0),0)} h</span>
            </div>
          )}
        </div>
      )}
      {valitut.length===0&&<Hint>Valitse tekijät ylhäältä</Hint>}
    </>
  );
}

// ── KoneStatus ────────────────────────────────────────────────────────────────
function KoneStatus({koneet, kstat, onSet, onBack}) {
  const [open,  setOpen]  = useState(null);
  const [sid,   setSid]   = useState("ok");
  const [note,  setNote]  = useState("");
  const [saved, setSaved] = useState(false);

  const openKone=k=>{const cur=kstat[k];setOpen(k);setSid(cur?.status||"ok");setNote(cur?.note||"");setSaved(false);};
  const save=async()=>{await onSet(open,sid,note);setSaved(true);setTimeout(()=>{setSaved(false);setOpen(null);},1200);};

  return(
    <div style={R.root}>
      <div style={R.header}><div style={R.htop}><div style={R.logo}>📊 KONESTATUS</div><Btn onClick={onBack}>← Takaisin</Btn></div></div>
      <div style={R.body}>
        <div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8,padding:12,marginBottom:16,fontSize:11,color:"#92400e"}}>
          Reaaliaikainen jaettu näkymä — kaikki käyttäjät näkevät samat statukset.
        </div>
        {koneet.map(k=>{
          const ks=kstat[k]; const st=kss(ks?.status);
          const isOpen=open===k;
          return(
            <div key={k} style={{marginBottom:8}}>
              <div style={{...R.card,cursor:"pointer",borderColor:isOpen?st.c:"#e5e7eb",background:isOpen?st.c+"0a":"#fff"}}
                onClick={()=>isOpen?setOpen(null):openKone(k)}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                  <div>
                    <div style={{fontWeight:700,fontSize:14,color:"#111827"}}>{k}</div>
                    {ks?.note&&<div style={{fontSize:11,color:"#6b7280",marginTop:2}}>{ks.note}</div>}
                    {ks?.ts&&<div style={{fontSize:10,color:"#9ca3af",marginTop:2}}>{fd(ks.ts)} {ft(ks.ts)}</div>}
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:20}}>{st.icon}</div>
                    <div style={{fontSize:10,fontWeight:700,color:st.c,background:st.c+"18",padding:"2px 8px",borderRadius:10,border:`1px solid ${st.c}44`,marginTop:4,whiteSpace:"nowrap"}}>{st.label}</div>
                  </div>
                </div>
              </div>
              {isOpen&&(
                <div style={{background:"#f9fafb",border:"1px solid #e5e7eb",borderTop:"none",borderRadius:"0 0 10px 10px",padding:16,marginTop:-8}}>
                  <div style={R.lbl}>VAIHDA STATUS</div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:8,margin:"8px 0 14px"}}>
                    {KS_STATUS.map(s=>(
                      <button key={s.id} onClick={()=>setSid(s.id)}
                        style={{...R.stBtn,borderColor:s.c,background:sid===s.id?s.c:"transparent",color:sid===s.id?"#fff":s.c,fontSize:11}}>
                        {s.icon} {s.label}
                      </button>
                    ))}
                  </div>
                  <div style={R.lbl}>MUISTIINPANO</div>
                  <input style={{...R.input,marginTop:6,marginBottom:12}}
                    placeholder="esim. Hydrauliöljyvuoto..." value={note} onChange={e=>setNote(e.target.value)}/>
                  <Btn primary full onClick={save}>{saved?"✓ TALLENNETTU!":"💾 TALLENNA STATUS"}</Btn>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}


// ── Arkisto ───────────────────────────────────────────────────────────────────
function Arkisto({woList, onSelect, onBack}) {
  const [haku, setHaku] = useState("");
  const filtered = woList
    .filter(w => {
      if (!haku) return true;
      const h = haku.toLowerCase();
      return [w.kone, w.kuvaus, w.id].some(x => x?.toLowerCase().includes(h));
    })
    .sort((a,b) => new Date(b.luotu)-new Date(a.luotu));

  return (
    <div style={R.root}>
      <div style={R.header}>
        <div style={R.htop}>
          <div><div style={R.logo}>📦 ARKISTO</div><div style={R.sub}>Valmiit työmääräimet</div></div>
          <Btn onClick={onBack}>← Takaisin</Btn>
        </div>
      </div>
      <div style={R.body}>
        <input style={R.search} placeholder="🔍  Hae..." value={haku} onChange={e=>setHaku(e.target.value)}/>
        {filtered.length===0&&<div style={{textAlign:"center",marginTop:60,color:"#bbb"}}>📦<br/>Ei arkistoituja töitä</div>}
        {filtered.map(w=>{
          const ts=tekijatListaus(w);
          return(
            <div key={w.id} style={{...R.card,borderLeft:"4px solid #16a34a"}} onClick={()=>onSelect(w)}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                <span style={{fontSize:10,color:"#d97706",fontWeight:700,letterSpacing:2}}>{w.id}</span>
                <span style={{fontSize:11,color:"#16a34a",fontWeight:700}}>✓ Valmis</span>
              </div>
              <div style={{fontWeight:700,fontSize:16,color:"#111827",marginBottom:4}}>{w.kone}</div>
              <div style={{fontSize:14,color:"#6b7280",marginBottom:8,overflow:"hidden",textOverflow:"ellipsis",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>{w.kuvaus}</div>
              <div style={{display:"flex",gap:12,fontSize:13,color:"#9ca3af",flexWrap:"wrap"}}>
                {ts&&<span>👤 {ts}</span>}
                <span>🔢 {w.konetunnit||"?"}h</span>
                <span>⏱ {sumH(w)}h</span>
                <span>📅 {fd(w.pvm)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Settings ──────────────────────────────────────────────────────────────────
function Settings({koneet, tekijat, onSave, onBack}) {
  const [kl,setKl]=useState([...koneet]);
  const [tl,setTl]=useState([...tekijat]);
  const [nk,setNk]=useState(""); const [nt,setNt]=useState("");
  const [ok,setOk]=useState(false);
  const addK=()=>{if(nk.trim()){setKl(l=>[...l,nk.trim()]);setNk("");}};
  const addT=()=>{if(nt.trim()){setTl(l=>[...l,nt.trim()]);setNt("");}};
  const save=async()=>{await onSave(kl.filter(Boolean),tl.filter(Boolean));setOk(true);setTimeout(()=>setOk(false),2000);};

  return(
    <div style={R.root}>
      <div style={R.header}><div style={R.htop}><div style={R.logo}>⚙ ASETUKSET</div><Btn onClick={onBack}>← Takaisin</Btn></div></div>
      <div style={R.body}>
        <div style={R.card}>
          <div style={R.lbl}>KONELISTA</div>
          <div style={{marginTop:8,marginBottom:20}}>
            {kl.map((k,i)=>(
              <div key={i} style={{display:"flex",gap:8,marginBottom:6}}>
                <input style={{...R.input,flex:1,marginBottom:0}} value={k} onChange={e=>setKl(l=>l.map((x,j)=>j===i?e.target.value:x))}/>
                <button style={R.xBtn} onClick={()=>setKl(l=>l.filter((_,j)=>j!==i))}>✕</button>
              </div>
            ))}
            <div style={{display:"flex",gap:8}}>
              <input style={{...R.input,flex:1,marginBottom:0}} placeholder="Lisää kone..." value={nk} onChange={e=>setNk(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addK()}/>
              <button style={R.addBtn} onClick={addK}>+</button>
            </div>
          </div>
          <div style={R.lbl}>TEKIJÄLISTA</div>
          <div style={{marginTop:8,marginBottom:24}}>
            {tl.map((t,i)=>(
              <div key={i} style={{display:"flex",gap:8,marginBottom:6}}>
                <input style={{...R.input,flex:1,marginBottom:0}} value={t} onChange={e=>setTl(l=>l.map((x,j)=>j===i?e.target.value:x))}/>
                <button style={R.xBtn} onClick={()=>setTl(l=>l.filter((_,j)=>j!==i))}>✕</button>
              </div>
            ))}
            <div style={{display:"flex",gap:8}}>
              <input style={{...R.input,flex:1,marginBottom:0}} placeholder="Lisää tekijä..." value={nt} onChange={e=>setNt(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addT()}/>
              <button style={R.addBtn} onClick={addT}>+</button>
            </div>
          </div>
          <Btn primary full onClick={save}>{ok?"✓ TALLENNETTU!":"💾 TALLENNA ASETUKSET"}</Btn>
        </div>
      </div>
    </div>
  );
}


// ── Autocomplete ──────────────────────────────────────────────────────────────
function AutoField({style, placeholder, value, onChange, suggestions, rows}) {
  const [show, setShow] = useState(false);
  const [filtered, setFiltered] = useState([]);

  const handleChange = e => {
    const val = e.target.value;
    onChange(val);
    if (val.length >= 2) {
      const lower = val.toLowerCase();
      const matches = [...new Set(suggestions.filter(s =>
        s.toLowerCase().includes(lower) && s !== val
      ))].slice(0, 5);
      setFiltered(matches);
      setShow(matches.length > 0);
    } else {
      setShow(false);
    }
  };

  const select = s => {
    onChange(s);
    setShow(false);
  };

  if (rows) return (
    <div style={{position:"relative"}}>
      <textarea style={style} placeholder={placeholder} value={value}
        onChange={handleChange} onBlur={()=>setTimeout(()=>setShow(false),150)}
        onFocus={()=>value.length>=2&&handleChange({target:{value}})}/>
      {show&&(
        <div style={{position:"absolute",top:"100%",left:0,right:0,background:"#fff",
          border:"1px solid #e5e7eb",borderRadius:6,zIndex:100,boxShadow:"0 4px 12px #00000015"}}>
          {filtered.map((s,i)=>(
            <div key={i} onClick={()=>select(s)}
              style={{padding:"10px 14px",fontSize:13,color:"#374151",cursor:"pointer",
                borderBottom:i<filtered.length-1?"1px solid #f3f4f6":"none"}}>
              {s}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div style={{position:"relative"}}>
      <input style={style} placeholder={placeholder} value={value}
        onChange={handleChange} onBlur={()=>setTimeout(()=>setShow(false),150)}
        onFocus={()=>value.length>=2&&handleChange({target:{value}})}/>
      {show&&(
        <div style={{position:"absolute",top:"100%",left:0,right:0,background:"#fff",
          border:"1px solid #e5e7eb",borderRadius:6,zIndex:100,boxShadow:"0 4px 12px #00000015"}}>
          {filtered.map((s,i)=>(
            <div key={i} onClick={()=>select(s)}
              style={{padding:"10px 14px",fontSize:13,color:"#374151",cursor:"pointer",
                borderBottom:i<filtered.length-1?"1px solid #f3f4f6":"none"}}>
              {s}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Small components ──────────────────────────────────────────────────────────
function Btn({children,onClick,primary,icon,full,disabled}){
  return <button onClick={onClick} disabled={disabled} style={{
    background:primary?"#d97706":"#f9fafb",color:primary?"#fff":"#6b7280",
    border:primary?"none":"1px solid #e5e7eb",borderRadius:6,
    padding:icon?"6px 10px":full?"14px":"7px 14px",
    fontSize:full?14:12,fontWeight:700,fontFamily:"'Courier New',monospace",
    letterSpacing:0.5,cursor:disabled?"not-allowed":"pointer",
    opacity:disabled?0.4:1,width:full?"100%":"auto",
  }}>{children}</button>;
}
function Label({children}){return <div style={{fontSize:10,color:"#9ca3af",letterSpacing:1.5,fontFamily:"monospace",marginBottom:4,marginTop:14,textTransform:"uppercase"}}>{children}</div>;}
function Hint({children,red}){return <div style={{fontSize:10,color:red?"#dc2626":"#9ca3af",marginBottom:6}}>{children}</div>;}
function Sec({label,children}){return <div style={{marginBottom:14}}><div style={R.lbl}>{label}</div><div style={{fontSize:14,color:"#374151",lineHeight:1.5,marginTop:4}}>{children}</div></div>;}

// ── Styles ────────────────────────────────────────────────────────────────────
const R={
  root:   {background:"#f3f4f6",minHeight:"100vh",fontFamily:"'Courier New',monospace",color:"#1f2937",maxWidth:480,margin:"0 auto"},
  header: {background:"#fff",borderBottom:"3px solid #d97706",padding:"14px 16px 12px",position:"sticky",top:0,zIndex:10,boxShadow:"0 2px 6px #00000010"},
  htop:   {display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10},
  logo:   {fontSize:18,fontWeight:700,color:"#d97706",letterSpacing:2},
  sub:    {fontSize:12,color:"#9ca3af",letterSpacing:1,marginTop:2},
  body:   {padding:16},
  chip:   {border:"1px solid",borderRadius:6,padding:"4px 10px",display:"flex",alignItems:"center",gap:4},
  csvBtn: {background:"#f9fafb",border:"1px solid #e5e7eb",color:"#9ca3af",borderRadius:6,padding:"4px 10px",fontSize:10,fontFamily:"'Courier New',monospace",cursor:"pointer"},
  search: {width:"100%",background:"#fff",border:"1px solid #e5e7eb",borderRadius:8,color:"#1f2937",padding:"10px 12px",fontSize:15,fontFamily:"'Courier New',monospace",marginBottom:14,boxSizing:"border-box",boxShadow:"0 1px 3px #00000008"},
  card:   {background:"#fff",border:"1px solid #e5e7eb",borderRadius:10,padding:16,marginBottom:10,boxShadow:"0 1px 4px #00000008"},
  badge:  {fontSize:11,fontWeight:700,padding:"4px 10px",borderRadius:10,letterSpacing:0.5,whiteSpace:"nowrap"},
  tbox:   {background:"#f9fafb",border:"1px solid #e5e7eb",borderRadius:8,padding:"10px 14px",marginBottom:4},
  lbl:    {fontSize:11,color:"#9ca3af",letterSpacing:2,textTransform:"uppercase",marginBottom:4},
  input:  {width:"100%",background:"#f9fafb",border:"1px solid #e5e7eb",borderRadius:6,color:"#1f2937",padding:"12px 14px",fontSize:15,fontFamily:"'Courier New',monospace",boxSizing:"border-box",outline:"none",marginBottom:6},
  stBtn:  {background:"transparent",border:"1px solid",borderRadius:6,padding:"8px 14px",fontSize:13,fontWeight:700,fontFamily:"'Courier New',monospace",cursor:"pointer"},
  pdfBtn: {width:"100%",background:"#fff",border:"1px solid #d97706",color:"#d97706",padding:"10px",borderRadius:6,fontSize:12,fontFamily:"'Courier New',monospace",cursor:"pointer",fontWeight:700,marginBottom:8},
  delBtn: {width:"100%",background:"transparent",border:"1px solid #e5e7eb",color:"#9ca3af",padding:"10px",borderRadius:6,fontSize:12,fontFamily:"'Courier New',monospace",cursor:"pointer"},
  xBtn:   {background:"transparent",border:"1px solid #fecaca",color:"#dc2626",borderRadius:6,padding:"8px 10px",cursor:"pointer",fontSize:12,flexShrink:0},
  addBtn: {background:"#d97706",color:"#fff",border:"none",borderRadius:6,padding:"8px 12px",cursor:"pointer",fontSize:14,fontWeight:700,flexShrink:0},
};
