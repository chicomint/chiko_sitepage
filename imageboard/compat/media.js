'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const sharp = require('sharp');
const { inspectVideoBuffer, validateVideoProbe } = require('../lib/uploads');
const { httpError } = require('../lib/utils');
const run = promisify(execFile);

async function writeOnce(filename, bytes) {
  try { await fs.writeFile(filename, bytes, { flag: 'wx', mode: 0o640 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
}

class Media {
  constructor(directory) { this.directory=path.resolve(directory); }
  async save(upload) {
    const video = inspectVideoBuffer(upload.buffer);
    let bytes, thumbnail, extension, mime, width, height;
    if (video) {
      const temporary = await fs.mkdtemp(path.join(os.tmpdir(),'chiko-video-'));
      try {
        extension=video.extensions[0];mime=video.mime;
        const input=path.join(temporary,'input'+extension), output=path.join(temporary,'output'+extension);
        await fs.writeFile(input,upload.buffer,{mode:0o600});
        const probe=await run(process.env.FFPROBE_PATH || require('ffprobe-static').path,['-v','error','-show_format','-show_streams','-of','json',input],{timeout:15000,maxBuffer:1024*1024});
        const info=validateVideoProbe(JSON.parse(probe.stdout),extension,{maxVideoDimension:4096,maxVideoPixels:16*1024*1024,maxVideoDurationMs:300000,maxVideoFrameRate:120});
        ({width,height}=info);
        const binary=process.env.FFMPEG_PATH || require('ffmpeg-static');
        await run(binary,['-nostdin','-v','error','-i',input,'-map_metadata','-1','-map_chapters','-1','-c','copy',...(extension==='.mp4'?['-movflags','+faststart']:[]),output],{timeout:20000,maxBuffer:1024*1024});
        bytes=await fs.readFile(output);
        const result=await run(binary,['-nostdin','-v','error','-i',input,'-frames:v','1','-vf','scale=320:320:force_original_aspect_ratio=decrease','-threads','1','-f','image2pipe','-vcodec','mjpeg','pipe:1'],{timeout:20000,maxBuffer:2*1024*1024,encoding:'buffer'});
        thumbnail=result.stdout;
      } finally { await fs.rm(temporary,{recursive:true,force:true}); }
    } else {
      try {
        const image=sharp(upload.buffer,{animated:true,limitInputPixels:16*1024*1024});
        const info=await image.metadata();
        if (!['jpeg','png','gif','webp'].includes(info.format) || !info.width || !info.height || info.width>16384 || (info.pageHeight || info.height)>16384 || (info.pages || 1)>200 || info.width*info.height>16*1024*1024) throw new Error('Unsupported image.');
        extension={jpeg:'.jpg',png:'.png',gif:'.gif',webp:'.webp'}[info.format];
        mime=`image/${info.format==='jpeg'?'jpeg':info.format}`;
        // Re-encoding strips metadata and validates every decoded frame.
        bytes=await image.toFormat(info.format).toBuffer();
        thumbnail=await sharp(upload.buffer,{limitInputPixels:16*1024*1024}).resize({width:320,height:320,fit:'inside',withoutEnlargement:true}).jpeg({quality:80}).toBuffer();
        width=info.width;height=info.pageHeight || info.height;
      } catch { throw httpError(400,'Upload a valid JPEG, PNG, GIF, WebP, MP4 or WebM file.'); }
    }
    if (bytes.length>25*1024*1024) throw httpError(400,'The processed attachment is too large.');
    const sha256=createHash('sha256').update(bytes).digest('hex');
    await fs.mkdir(this.directory,{recursive:true,mode:0o750});
    const name=sha256+extension, thumb=sha256+'.thumb.jpg';
    await writeOnce(path.join(this.directory,name),bytes);
    await writeOnce(path.join(this.directory,thumb),thumbnail);
    return {originalName:String(upload.originalname || 'attachment').slice(0,200),path:`/media/${name}`,thumb:`/media/${thumb}`,mime,size:bytes.length,sha256,width,height};
  }
}

module.exports={Media};
