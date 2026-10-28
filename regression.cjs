const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(__dirname+'/js/app.js','utf8');
async function main(){
 const start=source.indexOf('const idMap=new Map();'),end=source.indexOf("await save();applyAppearance();render();toast('Backup restored')",start);
 const helper=source.slice(source.indexOf('function restorePreferences('),source.indexOf('function settingsPage('));
 const context={books:[{id:'local',hash:'same'}],annotations:[],vocabulary:[],sessions:[],prefs:{},data:{books:[{id:'backup',hash:'same'}],annotations:[{id:'note',bookId:'backup'}],vocabulary:[],sessions:[{id:'session',bookId:'backup',seconds:15}],prefs:{font:'Arial',target:'hi',spread:'auto',align:'justify',theme:'custom',customBg:'#123456',customFg:'#eeeeee',flow:'scrolled-doc',size:999,line:1.8}},langs:{ta:'Tamil',hi:'Hindi'},palettes:{paper:[]}};
 vm.createContext(context);
 await vm.runInContext('(async()=>{'+helper+source.slice(start,end)+'})()',context);
 assert.equal(context.books.length,1);assert.equal(context.annotations[0].bookId,'local');assert.equal(context.sessions[0].bookId,'local');
 for(const key of ['font','target','spread','align','theme','customBg','customFg','flow','line'])assert.equal(context.prefs[key],context.data.prefs[key]);
 assert.equal(context.prefs.size,32);
 vm.runInContext(helper+"restorePreferences(prefs,{font:'evil',customBg:'url(x)',size:NaN});",context);
 assert.equal(context.prefs.font,'Arial');assert.equal(context.prefs.customBg,'#123456');assert.equal(context.prefs.size,32);
 console.log('PASS backup ID remapping, preference round-trip, invalid preference rejection');
 const open=source.slice(source.indexOf('async function openBook(b)'),source.indexOf('\nfunction closeReader()'));
 let release,epubCalls=0;
 const nodes={};const state={readerRequest:0,book:null,current:null,selected:null,document:{body:{style:{}}},$:key=>nodes[key]||(nodes[key]={replaceChildren(){}}),fetch:()=>new Promise(resolve=>release=resolve),ePub:()=>{epubCalls++;throw Error('must not render cancelled request')},toast:()=>{},closeReader:()=>{state.readerRequest++;state.book=null;state.current=null}};
 vm.createContext(state);vm.runInContext(open,state);
 const opening=state.openBook({demo:true,path:'test.epub',title:'Test'});
 state.closeReader();release({arrayBuffer:async()=>new ArrayBuffer(1)});await opening;assert.equal(epubCalls,0);
 let ready;let destroyed=0;
 state.fetch=async()=>({arrayBuffer:async()=>new ArrayBuffer(1)});
 state.ePub=()=>({ready:new Promise(resolve=>ready=resolve),destroy(){destroyed++}});
 const waiting=state.openBook({demo:true,path:'test.epub',title:'Test'});
 await new Promise(resolve=>setImmediate(resolve));state.closeReader();ready();await waiting;assert.equal(destroyed,1);
 console.log('PASS close during fetch and close during EPUB initialization');
 const events={},cache=new Map([['app','old']]);let online=true;
 const sw={self:{location:{origin:'https://example.com'},addEventListener:(name,fn)=>events[name]=fn,clients:{claim(){}},skipWaiting(){}},caches:{open:async()=>({match:async request=>cache.get(request.url),put:async(request,response)=>cache.set(request.url,response.value)})},fetch:async()=>{if(!online)throw Error('offline');return {ok:true,value:'new',clone(){return this}}},URL};
 vm.createContext(sw);vm.runInContext(fs.readFileSync(__dirname+'/sw.js','utf8'),sw);
 async function request(){let result;events.fetch({request:{url:'https://example.com/app',method:'GET'},respondWith(value){result=value}});return result}
 cache.set('https://example.com/app','old');assert.equal((await request()).value,'new');online=false;assert.equal(await request(),'new');
 console.log('PASS online cache refresh and offline fallback');
}
main().catch(error=>{console.error(error);process.exitCode=1});
