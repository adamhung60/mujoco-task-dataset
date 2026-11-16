
(async () => {
  const root=document.getElementById('pose-range-preview');
  const response=await fetch('pose-range-preview-data.json');
  if (!response.ok) throw Error(`Pose data: HTTP ${response.status}`);
  const data=await response.json();
  root.dataset.ready='true';
  const names=['before','after'];
  const selected={before:{kind:'camera',index:0},after:{kind:'camera',index:0}};
  const hits={before:[],after:[]};
  let yaw=.78,elev=.56,zoom=430,drag=null;
  const sub=(a,b)=>a.map((x,i)=>x-b[i]);
  const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const norm=a=>{const n=Math.hypot(...a)||1;return a.map(x=>x/n)};
  const color=name=>getComputedStyle(root).getPropertyValue(name).trim();
  function colors(){return {camera:color('--viz-series-1')||color('--blue'),robot:color('--viz-series-2')||color('--orange'),table:color('--muted'),ink:color('--foreground'),secondary:color('--muted-foreground'),background:color('--background'),grid:color('--border')}}
  const fmt=v=>(v*100).toFixed(1)+' cm';
  function detail(name){const choice=selected[name],item=data.sets[name][choice.kind==='camera'?'cameras':'robots'][choice.index],value=choice.kind==='camera'?`camera ${item.camera.map(fmt).join(', ')} · distance ${fmt(Math.hypot(...sub(item.camera,item.target)))} · FOV ${item.fov.toFixed(1)}°`:`robot base ${item.robot.map(fmt).join(', ')} · yaw ${item.yaw.toFixed(1)}°`;root.querySelector('#detail-'+name).textContent=`${choice.kind==='camera'?'Camera':'Robot'} ${choice.index+1} · ${value}`}
  function selectedRobot(name){const choice=selected[name],list=data.sets[name].robots;return list[choice.kind==='robot'?choice.index:0]}
  function draw(name){
    const canvas=root.querySelector('#pose-'+name),rect=canvas.getBoundingClientRect(),ratio=devicePixelRatio||1;
    canvas.width=Math.max(1,Math.round(rect.width*ratio));canvas.height=Math.max(1,Math.round(rect.height*ratio));
    const ctx=canvas.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);
    const c=colors(),w=rect.width,h=rect.height,center=[-.06,0,.10],right=[-Math.sin(yaw),Math.cos(yaw),0],toward=[Math.cos(elev)*Math.cos(yaw),Math.cos(elev)*Math.sin(yaw),Math.sin(elev)],up=cross(toward,right);
    const proj=p=>{const q=sub(p,center);return [w/2+dot(q,right)*zoom,h/2-dot(q,up)*zoom]};
    const line=(a,b,stroke,width=1)=>{const p=proj(a),q=proj(b);ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(...p);ctx.lineTo(...q);ctx.stroke()};
    ctx.fillStyle=c.background;ctx.fillRect(0,0,w,h);
    const table=[[-.31,-.5,0],[.7,-.5,0],[.7,.5,0],[-.31,.5,0]].map(proj);
    ctx.fillStyle=c.table;ctx.beginPath();ctx.moveTo(...table[0]);for(const p of table.slice(1))ctx.lineTo(...p);ctx.closePath();ctx.fill();
    for(let i=0;i<4;i++)line([[-.31,-.5,0],[.7,-.5,0],[.7,.5,0],[-.31,.5,0]][i],[[-.31,-.5,0],[.7,-.5,0],[.7,.5,0],[-.31,.5,0]][(i+1)%4],c.grid,1);
    const robot=selectedRobot(name),angle=robot.yaw*Math.PI/180,rotate=p=>[robot.robot[0]+p[0]*Math.cos(angle)-p[1]*Math.sin(angle),robot.robot[1]+p[0]*Math.sin(angle)+p[1]*Math.cos(angle),robot.robot[2]+p[2]],edges=[[0,1],[0,2],[0,4],[1,3],[1,5],[2,3],[2,6],[3,7],[4,5],[4,6],[5,7],[6,7]];
    ctx.globalAlpha=.65;for(const box of data.robot_boxes){const points=box.map(rotate);for(const [i,j] of edges)line(points[i],points[j],c.secondary,.8)}ctx.globalAlpha=1;
    hits[name]=[];
    for(const [i,item] of data.sets[name].cameras.entries()){
      const origin=item.camera,forward=norm(sub(item.target,origin)),side=norm(cross(forward,[0,0,1])),vertical=norm(cross(side,forward)),depth=.055,halfY=depth*Math.tan(item.fov*Math.PI/360),halfX=halfY*512/352;
      const corners=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([sx,sy])=>origin.map((v,k)=>v+forward[k]*depth+side[k]*sx*halfX+vertical[k]*sy*halfY));
      const active=selected[name].kind==='camera'&&selected[name].index===i;ctx.globalAlpha=active?1:.36;
      for(let j=0;j<4;j++){line(origin,corners[j],c.camera,active?2.3:1);line(corners[j],corners[(j+1)%4],c.camera,active?2.3:1)}
      const p=proj(origin);ctx.fillStyle=c.camera;ctx.beginPath();ctx.arc(...p,active?5:3,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;hits[name].push({kind:'camera',index:i,p});
    }
    for(const [i,item] of data.sets[name].robots.entries()){
      const active=selected[name].kind==='robot'&&selected[name].index===i,p=proj(item.robot);ctx.globalAlpha=active?1:.45;
      ctx.fillStyle=c.robot;ctx.fillRect(p[0]-(active?5:3),p[1]-(active?5:3),active?10:6,active?10:6);
      const az=item.yaw*Math.PI/180,tip=[item.robot[0]+.045*Math.cos(az),item.robot[1]+.045*Math.sin(az),item.robot[2]];line(item.robot,tip,c.robot,active?2.3:1);ctx.globalAlpha=1;hits[name].push({kind:'robot',index:i,p});
    }
    ctx.fillStyle=c.secondary;ctx.font='12px system-ui';ctx.fillText('● camera',10,18);ctx.fillText('■ robot base',10,35);
  }
  function redraw(){for(const name of names){draw(name);detail(name)}}
  for(const name of names){
    const select=root.querySelector('#pick-'+name),canvas=root.querySelector('#pose-'+name);
    for(const kind of ['camera','robot'])for(let i=0;i<20;i++)select.add(new Option(`${kind==='camera'?'Camera':'Robot'} ${i+1}`,kind+':'+i));
    select.onchange=()=>{const [kind,index]=select.value.split(':');selected[name]={kind,index:Number(index)};redraw()};
    canvas.onpointerdown=e=>{const r=canvas.getBoundingClientRect();drag={name,x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY};canvas.setPointerCapture(e.pointerId)};
    canvas.onpointermove=e=>{if(!drag||drag.name!==name)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)>3){yaw-=dx*.008;elev=Math.max(-.1,Math.min(1.5,elev+dy*.008));redraw()}drag.x=e.clientX;drag.y=e.clientY};
    canvas.onpointerup=e=>{if(drag&&Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)<5){const r=canvas.getBoundingClientRect(),p=[e.clientX-r.left,e.clientY-r.top],nearest=hits[name].map(hit=>({...hit,d:Math.hypot(p[0]-hit.p[0],p[1]-hit.p[1])})).sort((a,b)=>a.d-b.d)[0];if(nearest&&nearest.d<14){selected[name]={kind:nearest.kind,index:nearest.index};select.value=nearest.kind+':'+nearest.index;redraw()}}drag=null;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId)};
    canvas.onpointercancel=()=>drag=null;
    canvas.onwheel=e=>{e.preventDefault();zoom=Math.max(220,Math.min(1200,zoom*Math.exp(-e.deltaY*.001)));redraw()};
  }
  new ResizeObserver(redraw).observe(root.querySelector('#pose-before'));
  new ResizeObserver(redraw).observe(root.querySelector('#pose-after'));
  redraw();
  document.getElementById('preview-status').textContent='Showing 20 camera and 20 robot poses for each range.';
})().catch(error=>{document.getElementById('preview-status').textContent=`Could not load pose preview: ${error.message}`;});
