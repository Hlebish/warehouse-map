const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const vm=require('node:vm');
const edits=require('../warehouse-edits.js');

function app({kind='cell',journalFailures=1,writeError,afterJournal}={}){
 const source=readFileSync(join(__dirname,'../index.html'),'utf8');
 const slice=(start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b);};
 const nodes=new Map();
 const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',dataset:{},style:{},hidden:true,readOnly:false,focus(){}});return nodes.get(id);};
 const writes=[],sync=[];let server='A',commits=0,keys=0,closed=0,remainingFailures=journalFailures;
 const context={
  document:{getElementById:node},console:{warn(){},error(){}},
  current:{s:'S1',l:'A',n:'1'},currentSpecial:'resale',
  cellEditBaseline:'A',specialEditBaseline:'A',cellSavePending:false,specialSavePending:false,
  cellPendingJournals:new Map(),specialPendingJournals:new Map(),
  data:{S1:{A:{1:'A',2:'OTHER'}}},specialData:{resale:'A'},itemMeta:{'S1-A-1:A':{addedAt:1}},
  canEdit:()=>true,address:(s,l,n)=>[s,l,n].join('-'),itemKey:(addr,line)=>addr+':'+line,
  nowTs:()=>10,currentUserEmail:()=>'editor@example.test',
  firebase:{database:{ServerValue:{TIMESTAMP:{'.sv':'timestamp'}}}},
  setSync:(message,state)=>sync.push({message,state}),showAppToast(){},setLocal(){},
  render(){},renderSpecial(){},doSearch(){},clearMapTarget(){},renderItemMeta(){},setTimeout(){},confirm:()=>true,
  WarehouseEdits:{...edits,async saveComparedValue(_ref,expected,value){
   commits++;if(writeError)throw writeError;
   if(server!==expected)throw Object.assign(Error('conflict'),{code:'warehouse/conflict',currentValue:server});
   server=value;return value;
  }},
  rootRef:{child(path){return {child(next){return context.rootRef.child(path+'/'+next);},push(){return {key:'event-'+(++keys)};},get:async()=>({val:()=>server})};},async update(updates){
   writes.push(JSON.parse(JSON.stringify(updates)));
   if(remainingFailures-->0)throw Object.assign(Error('journal denied'),{code:'PERMISSION_DENIED'});
   if(afterJournal)afterJournal(context,value=>{server=value;});
  }}
 };
 vm.createContext(context);
 vm.runInContext(slice('function editFeedback(', 'function moveAllowedShelves(')+slice('async function saveCell(){','function renderSpecial(){'),context);
 const originalCloseCell=context.closeModal,originalCloseSpecial=context.closeSpecial;
 context.closeModal=()=>{closed++;originalCloseCell();};context.closeSpecial=()=>{closed++;originalCloseSpecial();};
 node('content').value='A\nB';node('specialContent').value='A\nB';
 const save=()=>kind==='cell'?context.saveCell():context.saveSpecial();
 return {context,node,writes,sync,save,get commits(){return commits;},get closed(){return closed;},get server(){return server;},set server(value){server=value;}};
}

for(const kind of ['cell','special']){
 test(kind+' journal retry keeps original IDs and does not write the saved value twice',async()=>{
  const ui=app({kind}),input=ui.node(kind==='cell'?'content':'specialContent'),button=ui.node(kind==='cell'?'saveCellButton':'saveSpecialButton');
  await ui.save();
  assert.equal(ui.server,'A\nB');assert.equal(ui.commits,1);assert.equal(ui.closed,0);
  assert.equal(input.readOnly,true);assert.match(button.textContent,/Повторить запись истории/);
  await ui.save();
  assert.equal(ui.commits,1);assert.equal(ui.closed,1);assert.equal(ui.writes.length,2);
  assert.deepEqual(ui.writes[0],ui.writes[1]);
  assert.ok(Object.keys(ui.writes[1]).some(path=>path.startsWith('history/')));
  assert.equal(input.readOnly,false);
 });

 test(kind+' failed value write keeps the original text editable and creates no journal retry',async()=>{
  const ui=app({kind,writeError:Object.assign(Error('denied'),{code:'PERMISSION_DENIED'})});
  await ui.save();
  const input=ui.node(kind==='cell'?'content':'specialContent');
  assert.equal(ui.server,'A');assert.equal(ui.writes.length,0);assert.equal(ui.closed,0);
  assert.equal(input.value,'A\nB');assert.equal(input.readOnly,false);
  assert.equal((kind==='cell'?ui.context.cellPendingJournals:ui.context.specialPendingJournals).size,0);
 });

 test(kind+' journal retry preserves a newer employee edit and shows both versions',async()=>{
  const ui=app({kind});await ui.save();
  ui.server='NEWER';
  if(kind==='cell')ui.context.data.S1.A[1]='NEWER';else ui.context.specialData.resale='NEWER';
  await ui.save();
  assert.equal(ui.server,'NEWER');assert.equal(ui.commits,1);assert.equal(ui.closed,0);
  assert.ok(Object.keys(ui.writes[1]).every(path=>path.startsWith('history/')));
  assert.equal(ui.node(kind+'ConflictValue').value,'NEWER');assert.equal(ui.node(kind+'Conflict').hidden,false);
  assert.equal(ui.node(kind==='cell'?'content':'specialContent').value,'A\nB');
  assert.match(ui.node(kind+'SaveStatus').textContent,/другой сотрудник/);
 });

 test(kind+' late journal completion does not replace a newer live-listener cache snapshot',async()=>{
  const ui=app({kind,journalFailures:0,afterJournal(context,setServer){setServer('LATEST');if(kind==='cell')context.data.S1.A[1]='LATEST';else context.specialData.resale='LATEST';}});
  await ui.save();
  assert.equal(ui.server,'LATEST');
  assert.equal(kind==='cell'?ui.context.data.S1.A[1]:ui.context.specialData.resale,'LATEST');
 });
}

test('reopening a partially saved cell restores its pending journal and saved text',async()=>{
 const ui=app();await ui.save();ui.context.closeModal();
 ui.context.openModal('S1','A','2');assert.equal(ui.node('content').value,'OTHER');
 ui.context.openModal('S1','A','1');
 assert.equal(ui.node('content').value,'A\nB');assert.equal(ui.node('content').readOnly,true);
 assert.match(ui.node('saveCellButton').textContent,/Повторить запись истории/);
 await ui.save();assert.equal(ui.commits,1);assert.deepEqual(ui.writes[0],ui.writes[1]);
});
