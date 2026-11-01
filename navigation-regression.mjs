import assert from 'node:assert/strict';
import {resolveBookLink,installBookLinks,restoreBookLocations} from './js/book-navigation.js';
const a={href:'text/first.xhtml',url:'/EPUB/text/first.xhtml',index:0};
const b={href:'text/next.xhtml',url:'/EPUB/text/next.xhtml',index:1};
const book={spine:{spineItems:[a,b],get(href){return[a,b].find(s=>s.href===href.split('#')[0])}}};
for(const [href,section,target] of [['#topic',a,'text/first.xhtml#topic'],['next.xhtml#topic',a,'text/next.xhtml#topic'],['../text/first.xhtml#topic',b,'text/first.xhtml#topic'],['/EPUB/text/next.xhtml#topic',a,'text/next.xhtml#topic']]){
 const result=resolveBookLink(href,section,book);assert.equal(result.kind,'internal');assert.equal(result.target,target);
}
for(const href of ['https://example.com/#topic','http://example.com','//example.com/path','mailto:a@example.com','tel:112'])assert.equal(resolveBookLink(href,a,book).kind,'external');
for(const href of ['javascript:alert(1)','data:text/html,x','vbscript:x','blob:https://example.com/x','bad%xx.xhtml'])assert.equal(resolveBookLink(href,a,book).kind,'blocked');
assert.equal(resolveBookLink('missing.xhtml#topic',a,book).kind,'missing');
let listener,capture,displays=[],prompts=0,opened=[],errors=[],prevented=0,stopped=0;
const doc={addEventListener(type,fn,phase){listener=fn;capture=phase},removeEventListener(){},getElementById:id=>id==='topic'?{}:null};
const dispose=installBookLinks(doc,a,book,{display:async target=>displays.push(target)},{confirmExternal(){prompts++;return true},openExternal:href=>opened.push(href),showError:error=>errors.push(error)});
function click(href){listener({target:{closest:()=>({getAttribute:()=>href,href:'https://vaikundamani-l.github.io/leaf-reader/'+href})},preventDefault(){prevented++},stopImmediatePropagation(){stopped++}})}
click('#topic');await new Promise(setImmediate);
assert.deepEqual(displays,['text/first.xhtml#topic']);assert.equal(prompts,0);assert.equal(capture,true);
click('https://example.com/');assert.equal(prompts,1);assert.deepEqual(opened,['https://example.com/']);
click('#absent');await new Promise(setImmediate);assert.equal(errors.length,1);assert.equal(displays.length,1);
assert.equal(prevented,3);assert.equal(stopped,3);dispose();
console.log('PASS internal fragments, cross-file paths, archive-root paths, external confirmation, unsafe schemes, missing anchors and single click handling');

let restored=null;const locationBook={locations:{load(value){restored=value}}};
const compare=(a,b)=>a.localeCompare(b);
const valid=['epubcfi(1)','epubcfi(2)'];
assert.equal(restoreBookLocations(locationBook,JSON.stringify(valid),compare),true);assert.deepEqual(restored,valid);
assert.equal(restoreBookLocations(locationBook,JSON.stringify([...valid,...valid]),compare),false);
assert.equal(restoreBookLocations(locationBook,'invalid',compare),false);
console.log('PASS saved locations are reused and duplicated/out-of-order location caches are rejected');
