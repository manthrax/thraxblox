

let texs=(await ((await fetch("./block/textures.txt")).text())).split('\n').map(x => x.trim()).filter(x => x.length > 0);
let textures = []
let numTiles = 0;
let tileSize=64;
for(let i=0;i<texs.length;i++){
    let tex = await  (new THREE.TextureLoader()).loadAsync("./block/"+texs[i])
    tex.wrapS=tex.wrapT=THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    console.log('loaded:',texs[i],tex.source.data.width,tex.source.data.height)
    textures.push(tex)
    numTiles += (tex.source.data.width/tileSize)*(tex.source.data.height/tileSize);
}
function downloadCanvasAsWebp(canvas) {
    const link = document.createElement('a');
    link.download = 'my-image.webp';
    link.href = canvas.toDataURL('image/webp');
    link.click();
}
let tx=Math.ceil(Math.sqrt(numTiles));//1680))
let texDim = tx*tileSize;
let canv = document.createElement('canvas')
canv.height=canv.width=texDim;
let ctx = canv.getContext('2d');
let ipos=0;
for(let i=0;i<texs.length;i++){
    let height = textures[i].source.data.height;
    for(let ty=0,ti=0;ty<height;ty+=tileSize,ti++){
        let x=ipos%tx;
        let y=(ipos/tx)|0;
        
        ctx.drawImage(textures[i].source.data,0,ty,tileSize,tileSize,x*tileSize,y*tileSize,tileSize,tileSize);
        ipos++;
    }
}
downloadCanvasAsWebp(canv);
console.log("numTiles",numTiles)
