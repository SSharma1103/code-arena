import type { CubeState } from "@code-arena/contracts";

/** Trusted renderer shared by the embedded viewer and the model's screenshot tool. */
export function cubeDocument(
  state: CubeState,
  asset = "/runtime/three.min.js",
) {
  const data = JSON.stringify(state.cube).replace(/</g, "\\u003c");
  return `<!doctype html><html><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#161c1e}canvas{display:block;touch-action:none}p{position:absolute;bottom:12px;width:100%;text-align:center;color:#8d9b9c;font:11px sans-serif;pointer-events:none;letter-spacing:1px}</style><script src="${asset}"></script><canvas aria-label="Interactive cube"></canvas><p>DRAG TO ORBIT &nbsp; / &nbsp; SCROLL TO ZOOM</p><script>
const renderer=new THREE.WebGLRenderer({canvas:document.querySelector('canvas'),antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputEncoding=THREE.sRGBEncoding;renderer.setClearColor(0x161c1e);
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(36,1,.1,100),group=new THREE.Group();camera.position.set(6,5,7);camera.lookAt(0,0,0);scene.add(group,new THREE.HemisphereLight(0xffffff,0x748597,.85));const light=new THREE.DirectionalLight(0xffffff,.8);light.position.set(4,8,6);scene.add(light);
const colors={W:0xf2f4ef,Y:0xffd246,R:0xed5858,O:0xff9946,B:0x528bf5,G:0x57c995},tiles=[];
for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++){const m=new THREE.Mesh(new THREE.BoxGeometry(.97,.97,.97),new THREE.MeshStandardMaterial({color:0x10161b,roughness:.65}));m.position.set(x,y,z);group.add(m);}
for(const face of ['right','left','top','bottom','front','back'])for(let r=0;r<3;r++)for(let c=0;c<3;c++){const tile=new THREE.Mesh(new THREE.PlaneGeometry(.86,.86),new THREE.MeshStandardMaterial({roughness:.55}));if(face==='front')tile.position.set(c-1,1-r,1.49);if(face==='back'){tile.position.set(1-c,1-r,-1.49);tile.rotation.y=Math.PI;}if(face==='right'){tile.position.set(1.49,1-r,1-c);tile.rotation.y=Math.PI/2;}if(face==='left'){tile.position.set(-1.49,1-r,c-1);tile.rotation.y=-Math.PI/2;}if(face==='top'){tile.position.set(c-1,1.49,r-1);tile.rotation.x=-Math.PI/2;}if(face==='bottom'){tile.position.set(c-1,-1.49,1-r);tile.rotation.x=Math.PI/2;}group.add(tile);tiles.push({tile,face,r,c});}
function update(cube){for(const {tile,face,r,c} of tiles)tile.material.color.setHex(colors[cube.faces[face][r][c]]).convertSRGBToLinear();}update(${data});
addEventListener('message',e=>{if(e.source===parent&&e.data?.type==='cube-state'&&e.data.cube)update(e.data.cube);});
function resize(){renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();}addEventListener('resize',resize);resize();
let drag;const canvas=renderer.domElement;canvas.onpointerdown=e=>{drag=[e.clientX,e.clientY];canvas.setPointerCapture(e.pointerId);};canvas.onpointerup=canvas.onpointercancel=()=>drag=null;canvas.onpointermove=e=>{if(!drag)return;group.rotation.y+=(e.clientX-drag[0])*.008;group.rotation.x+=(e.clientY-drag[1])*.008;drag=[e.clientX,e.clientY];};canvas.addEventListener('wheel',e=>{e.preventDefault();camera.zoom=THREE.MathUtils.clamp(camera.zoom-e.deltaY*.001,.65,1.6);camera.updateProjectionMatrix();},{passive:false});renderer.setAnimationLoop(()=>renderer.render(scene,camera));window.cubeReady=true;
</script></html>`;
}
