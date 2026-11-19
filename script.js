const STEPS=["Received","In calibration","Quality check","Certificate ready","Collected"];
const $=s=>document.querySelector(s);
const esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const norm=s=>String(s||"").toUpperCase().replace(/[^A-Z0-9]/g,"");
const today=()=>new Date().toISOString().slice(0,10);
const fmt=d=>/^\d{4}-\d{2}-\d{2}$/.test(d||"")?new Date(d+"T00:00:00").toLocaleDateString("en-ZA",{day:"numeric",month:"long",year:"numeric"}):"";

function loadJobs(){
  return new Promise((res,rej)=>{
    delete window.JOBS;
    const s=document.createElement("script");
    s.src="jobs.js?t="+Date.now();
    s.onload=()=>{s.remove();const d=window.JOBS;d&&Array.isArray(d.jobs)?res(d):rej(new Error("format"))};
    s.onerror=()=>{s.remove();rej(new Error("load"))};
    document.head.appendChild(s);
  });
}
function stepper(job){
  const i=STEPS.indexOf(job.status),hist=job.hist||[];
  return '<ol class="steps">'+STEPS.map((s,k)=>{
    const h=hist.find(x=>x[0]===s);
    return '<li class="'+(k<i?"done":k===i?"now":"")+'"><span class="dot"></span><b>'+s+"</b>"+(h&&fmt(h[1])?"<small>"+fmt(h[1])+"</small>":"")+"</li>";
  }).join("")+"</ol>";
}

function initCustomer(){
  const form=$("#form"),input=$("#sro"),out=$("#result");
  const card=(t,p)=>'<section class="card"><h2>'+t+'</h2><p class="mut">'+p+"</p></section>";
  async function lookup(){
    const q=norm(input.value);
    if(!q){out.innerHTML=card("Enter your SRO number","You’ll find it on your service paperwork.");return}
    out.innerHTML=card("Checking…","One moment.");
    let data;
    try{data=await loadJobs()}catch(e){out.innerHTML=card("We can’t load updates right now","Please try again shortly or contact the service centre.");return}
    const job=data.jobs.find(j=>norm(j.sro)===q);
    if(!job){out.innerHTML=card("No job found","We couldn’t find “"+esc(input.value.trim())+"”. Check the number or contact the service centre. A new job can take a short while to appear.");return}
    const hist=job.hist||[],last=job.updated||(hist.length?hist[hist.length-1][1]:"");
    const ready=job.status==="Certificate ready";
    out.innerHTML='<section class="card"><div class="top"><div><h2>'+esc(job.sro)+'</h2><p class="mut">'+esc(job.item)+'</p></div><span class="badge'+(ready||job.status==="Collected"?" ok":"")+'">'+esc(job.status)+"</span></div>"+stepper(job)+(ready?'<p class="ready">Your instrument is ready for collection.</p>':"")+(job.note?"<blockquote><small>Message from the service centre</small>"+esc(job.note)+"</blockquote>":"")+'<p class="mut">Last updated '+(fmt(last)||"recently")+"</p></section>";
  }
  form.addEventListener("submit",e=>{e.preventDefault();lookup()});
  const p=new URLSearchParams(location.search).get("sro");
  if(p){input.value=p;lookup()}
}

function initStaff(){
  const SKEY="concilium-gh",app=$("#app");
  let cfg={owner:"",repo:"",token:"",branch:"main"},data={updated:"",jobs:[]},armed="",msg="",bad=false,queue=Promise.resolve();
  try{Object.assign(cfg,JSON.parse(localStorage.getItem(SKEY)||"{}"))}catch(e){}
  const ready=()=>!!(cfg.owner&&cfg.repo&&cfg.token);
  const base=()=>new URL("index.html",location.href).href;
  const url=()=>"https://api.github.com/repos/"+encodeURIComponent(cfg.owner)+"/"+encodeURIComponent(cfg.repo)+"/contents/jobs.js";
  const H=()=>({"Authorization":"Bearer "+cfg.token,"Accept":"application/vnd.github+json"});
  const b64=s=>btoa(unescape(encodeURIComponent(s)));
  const unb64=s=>decodeURIComponent(escape(atob(s.replace(/\s/g,""))));
  const parse=t=>{const x=JSON.parse(t.replace(/^\s*window\.JOBS\s*=\s*/,"").replace(/;\s*$/,""));if(!x||!Array.isArray(x.jobs))throw new Error("format");return x};
  const clock=()=>new Date().toLocaleTimeString("en-ZA",{hour:"2-digit",minute:"2-digit"});
  const errText=e=>({auth:"GitHub refused the token. Check it is allowed to read and write Contents for this repository, and that it hasn’t expired.",repo:"Can’t find the repository. Check the GitHub username and repository name.",busy:"Someone else is editing right now. Please try again.",fail:"Couldn’t reach GitHub. Check the internet and try again."}[e.message]||"Something went wrong. Please try again.");

  async function getRemote(){
    const r=await fetch(url()+"?ref="+encodeURIComponent(cfg.branch)+"&t="+Date.now(),{headers:H(),cache:"no-store"});
    if(r.status===404)throw new Error("repo");
    if(r.status===401||r.status===403)throw new Error("auth");
    if(!r.ok)throw new Error("fail");
    const j=await r.json();
    return {data:parse(unb64(j.content)),sha:j.sha};
  }
  function apply(d,op){
    if(op.del){d.jobs=d.jobs.filter(j=>norm(j.sro)!==norm(op.del))}
    else{
      const o=op.job;let j=d.jobs.find(x=>norm(x.sro)===norm(o.sro));
      if(!j){d.jobs.push({sro:o.sro,item:o.item,status:o.status,note:o.note||"",hist:[[o.status,today()]],updated:today()})}
      else{
        if(j.status!==o.status){j.hist=(j.hist||[]).filter(h=>h[0]!==o.status);j.hist.push([o.status,today()])}
        j.item=o.item;j.status=o.status;j.note=o.note||"";j.updated=today();
      }
    }
    d.updated=today();return d;
  }
  async function publish(op){
    for(let i=0;i<3;i++){
      const cur=await getRemote(),nd=apply(cur.data,op);
      const body={message:"Update job tracker",content:b64("window.JOBS = "+JSON.stringify(nd,null,2)+";\n"),branch:cfg.branch,sha:cur.sha};
      const r=await fetch(url(),{method:"PUT",headers:{...H(),"Content-Type":"application/json"},body:JSON.stringify(body)});
      if(r.ok)return nd;
      if(r.status===409||r.status===422)continue;
      if(r.status===401||r.status===403)throw new Error("auth");
      if(r.status===404)throw new Error("repo");
      throw new Error("fail");
    }
    throw new Error("busy");
  }
  function save(op){
    if(!ready()){msg="Fill in the publishing settings first (see the card below).";bad=true;return draw()}
    data=apply(JSON.parse(JSON.stringify(data)),op);
    msg="Publishing…";bad=false;draw();
    queue=queue.then(()=>publish(op)).then(d=>{data=d;bad=false;msg="Published at "+clock()+". Customers see it in about a minute."})
      .catch(e=>{bad=true;msg=errText(e)}).then(draw);
  }
  async function refresh(){
    msg="Loading…";bad=false;draw();
    try{data=(await getRemote()).data;msg="Loaded "+data.jobs.length+" job(s) from GitHub."}catch(e){bad=true;msg=errText(e)}
    draw();
  }
  function copy(text){
    const done=m=>{msg=m+text;bad=false;draw()};
    try{navigator.clipboard.writeText(text).then(()=>done("Copied: "),()=>done("Copy this: "))}catch(e){done("Copy this: ")}
  }
  function settingsCard(){
    return '<section class="card"><h2>Publishing settings</h2><p class="mut">'+(ready()?"Connected to "+esc(cfg.owner)+"/"+esc(cfg.repo)+". Saved on this computer only.":"Fill these in once. They are saved on this computer only.")+'</p><div class="row"><input class="f" id="gowner" placeholder="GitHub username" aria-label="GitHub username" value="'+esc(cfg.owner)+'"><input class="f" id="grepo" placeholder="Repository name" aria-label="Repository name" value="'+esc(cfg.repo)+'"></div><div class="row"><input class="f" id="gtoken" type="password" autocomplete="off" placeholder="'+(cfg.token?"Token saved (type a new one to replace it)":"GitHub token")+'" aria-label="GitHub token"><button id="gsave">Save settings</button></div></section>';
  }
  function draw(){
    const m=msg?'<p class="msg'+(bad?" bad":"")+'">'+esc(msg)+"</p>":"";
    const rows=data.jobs.slice().reverse().map(j=>'<div class="job"><div class="jh"><div><b>'+esc(j.sro)+'</b> <span class="mut">'+esc(j.item)+'</span></div><div class="acts"><button class="ghost" data-copy="'+esc(j.sro)+'">Copy link</button><button class="ghost" data-del="'+esc(j.sro)+'">'+(armed===j.sro?"Confirm remove":"Remove")+'</button></div></div><div class="jb"><select data-sro="'+esc(j.sro)+'" aria-label="Status for '+esc(j.sro)+'">'+STEPS.map(s=>"<option"+(s===j.status?" selected":"")+">"+s+"</option>").join("")+'</select><input class="f" data-note="'+esc(j.sro)+'" placeholder="Message for the customer (optional)" value="'+esc(j.note||"")+'"></div></div>').join("");
    app.innerHTML=(ready()?"":settingsCard())+
      '<section class="card"><h2>Customer link</h2><p class="mut">Customers open this page and type their SRO number.</p><div class="row"><input class="f" readonly value="'+esc(base())+'"><button data-copyall="1">Copy customer link</button></div>'+(location.protocol==="file:"?'<div class="warn">This page is open from your computer. Open the staff page from your website address to get the real customer link.</div>':"")+"</section>"+
      '<section class="card"><div class="top"><h2>Jobs</h2><button class="ghost" id="refresh">Refresh list</button></div><p class="mut">Changes are published to the customer website automatically. Anyone can read the job list, so don’t enter customer names.</p><div class="row"><input class="f" id="nsro" placeholder="SRO number, e.g. SRO000012345"><input class="f" id="nitem" placeholder="Instrument, e.g. Keysight 34401A"><button id="add">Add job</button></div>'+m+(rows||'<p class="mut">No jobs yet. Add the first one above.</p>')+"</section>"+(ready()?settingsCard():"");
  }
  app.addEventListener("click",e=>{
    const t=e.target,d=t.dataset||{};
    if(t.id==="gsave"){
      cfg.owner=$("#gowner").value.trim();cfg.repo=$("#grepo").value.trim();
      const tk=$("#gtoken").value.trim();if(tk)cfg.token=tk;
      try{localStorage.setItem(SKEY,JSON.stringify(cfg))}catch(x){}
      if(ready())refresh();else{msg="Enter the username, repository name and token.";bad=true;draw()}
    }
    if(t.id==="refresh"){ready()?refresh():(msg="Fill in the publishing settings first.",bad=true,draw())}
    if(t.id==="add"){
      const sro=$("#nsro").value.trim(),item=$("#nitem").value.trim();
      if(!sro||!item){msg="Enter both the SRO number and the instrument.";bad=true;return draw()}
      if(data.jobs.some(j=>norm(j.sro)===norm(sro))){msg=sro+" is already in the list.";bad=true;return draw()}
      save({job:{sro,item,status:STEPS[0],note:""}});
    }
    if(d.del){
      if(armed===d.del){const s=armed;armed="";save({del:s})}else{armed=d.del;draw()}
    }
    if(d.copy)copy(base()+"?sro="+encodeURIComponent(d.copy));
    if(d.copyall)copy(base());
  });
  app.addEventListener("change",e=>{
    const t=e.target,d=t.dataset||{};
    if(d.sro){const j=data.jobs.find(x=>x.sro===d.sro);if(j&&j.status!==t.value)save({job:{...j,status:t.value}})}
    if(d.note){const j=data.jobs.find(x=>x.sro===d.note);if(j&&(j.note||"")!==t.value.trim())save({job:{...j,note:t.value.trim()}})}
  });
  (async()=>{
    if(ready()){await refresh();return}
    try{data=await loadJobs()}catch(e){}
    draw();
  })();
}
document.body.dataset.page==="staff"?initStaff():initCustomer();
