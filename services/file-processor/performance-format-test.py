"""Bounded secondary format exploration. Fixed 2-second synthetic tones/scenes.
No providers/network; exact pre/post outputs compared. Not ASR/vision proof.
"""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import wave

repo=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument("--baseline", required=True)
parser.add_argument("--output", default=str(repo/".wrangler/performance/format-results.json"))
options=parser.parse_args()
worker=repo/'services/file-processor/performance-benchmark.py'
processors={'before':Path(options.baseline).resolve(),'after':repo/'services/file-processor/processor.py'}
audio=[('mp3','libmp3lame','mp3'),('m4a','aac','ipod'),('ogg','libvorbis','ogg'),('flac','flac','flac'),('aac','aac','adts')]
video=[('mov','libx264','mov'),('webm','libvpx-vp9','webm'),('avi','mpeg4','avi'),('mkv','ffv1','matroska')]
rows=[]
prefix=['ffmpeg','-nostdin','-y','-v','error','-threads','1','-filter_threads','1','-filter_complex_threads','1']
with tempfile.TemporaryDirectory(prefix='baro-format-boundary-') as tmp:
    root=Path(tmp)
    for category,formats in [('audio',audio),('video',video)]:
        for fmt,codec,mux in formats:
            src=root/(fmt+'.input')
            if category=='audio':
                args=['-f','lavfi','-i','sine=frequency=440:sample_rate=16000:duration=2','-ac','1','-c:a',codec,'-f',mux]
            else:
                args=['-f','lavfi','-i','color=c=blue:s=96x64:r=10:d=1','-f','lavfi','-i','color=c=red:s=96x64:r=10:d=1','-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[v]','-map','[v]','-c:v',codec,'-threads','1','-pix_fmt','yuv420p','-f',mux]
            made=subprocess.run(prefix+args+[str(src)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=60)
            if made.returncode:
                rows.append({'case':fmt,'category':category,'status':'generator-unavailable'})
                continue
            assert src.stat().st_size<=250000
            results={}; manifests={}
            for label,processor in processors.items():
                job=root/(fmt+'-'+label); job.mkdir(); shutil.copyfile(src,job/'input')
                run=subprocess.run([sys.executable,str(worker),'--worker','--processor',str(processor),'--root',str(job),'--unit','0'],capture_output=True,timeout=60)
                assert run.returncode==0
                metric=json.loads(run.stdout); results[label]=metric
                if metric['exitCode']:
                    manifests[label]=json.loads((job/'error.json').read_text())
                else:
                    manifests[label]=json.loads((job/'manifest.json').read_text())
            assert results['before']['exitCode']==results['after']['exitCode']
            assert manifests['before']==manifests['after']
            m=manifests['after']
            row={'case':fmt,'category':category,'inputBytes':src.stat().st_size,'before':results['before'],'after':results['after'],'manifestEqual':True}
            if results['after']['exitCode']:
                row.update(status='rejected-equally',safeError=m['code'],coveragePublished=False)
            else:
                for a in m['artifacts']:
                    assert (root/(fmt+'-before')/a['path']).read_bytes()==(root/(fmt+'-after')/a['path']).read_bytes()
                row.update(status='native-extraction-equal',reportedFormat=m['probe']['format'],durationSeconds=m['probe']['durationSeconds'],outputBytes=m['outputBytes'],artifactCount=len(m['artifacts']),coverage=m['coverage'],artifactBytesEqual=True)
                if category=='audio':
                    a=m['artifacts'][0]
                    with wave.open(str(root/(fmt+'-after')/a['path'])) as pcm:
                        row['artifactPcmSeconds']=pcm.getnframes()/pcm.getframerate()
                    if fmt=='m4a':
                        controls=[]
                        for label,seek,clip in [('service-seek-zero',['-ss','0'],['-t','2']),('no-seek-clipped',[],['-t','2']),('full-reference',[],[])]:
                            target=root/(label+'.wav')
                            decoded=subprocess.run(prefix+seek+['-i',str(src),'-threads','1']+clip+['-map','0:a:0','-vn','-ac','1','-ar','16000','-c:a','pcm_s16le','-f','wav',str(target)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=60)
                            assert decoded.returncode==0
                            with wave.open(str(target)) as pcm:
                                controls.append({'variant':label,'decodedPcmSeconds':pcm.getnframes()/pcm.getframerate(),'samples':pcm.getnframes()})
                        row['independentDecodeControls']=controls
            rows.append(row)
            print(fmt+': '+row['status'],flush=True)
report={'syntheticOnly':True,'serial':True,'repetitions':1,'maxSourceSeconds':2,'maxSourceBytes':250000,'scope':'secondary existing-format boundary exploration, not general codec/model proof','results':rows}
Path(options.output).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
