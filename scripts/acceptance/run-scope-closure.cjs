// Disposable PostgreSQL only. No env file, shared volume, QA URL, or live credentials.
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const out = path.resolve(root, process.argv[2] || 'release-evidence/v1-scope-closure-20261027/attempt1');
if (fs.existsSync(out)) throw Error('Refusing overwrite');
fs.mkdirSync(out, { recursive: true });
const id = crypto.randomBytes(6).toString('hex'), pwd = crypto.randomBytes(24).toString('hex');
const name = `tahili-acceptance-${id}-v1-db`, database = `acceptance_${id}`;
const env = { ...process.env, NODE_ENV: 'test', TAHILI_ENVIRONMENT: 'acceptance', TAHILI_DISPOSABLE_TEST_DB: '1', ACCEPTANCE_RUN_ID: id,
  COMPOSE_PROJECT_NAME: `tahili-acceptance-${id}`, ACCEPTANCE_APP_PORT: '38649', E2E_BASE_URL: 'http://127.0.0.1:38649',
  NEXTAUTH_URL: 'http://127.0.0.1:38649', NEXTAUTH_URL_INTERNAL: 'http://127.0.0.1:38649',
  ACCEPTANCE_DB_PORT: '45432', ACCEPTANCE_DB_PASSWORD: pwd, POSTGRES_PASSWORD: pwd, DATABASE_URL: `postgresql://acceptance:${pwd}@127.0.0.1:45432/${database}`,
  M46_STATE: path.join(out, 'LEGACY_STATE.json'), M44_STATE: path.join(out, 'FOUNDATION_STATE.json'), V1_STATE: path.join(out, 'V1_STATE.json') };
for (const k of ['DIRECT_URL', 'SHADOW_DATABASE_URL', 'DOTENV_CONFIG_PATH', 'NODE_OPTIONS', 'M44_CHECKPOINT']) delete env[k];
require('./guard.cjs').assertIsolatedTarget(env);
const clean = s => String(s || '').split(pwd).join('[REDACTED]');
const save = (n, v) => fs.writeFileSync(path.join(out, n), clean(JSON.stringify(v, null, 2)));
function run(exe, args, log, input, extraEnv = env) {
  const r = cp.spawnSync(exe, args, { cwd: root, env: extraEnv, input, encoding: 'utf8', windowsHide: true, timeout: 240000, maxBuffer: 30 * 1024 * 1024 });
  if (log) fs.writeFileSync(path.join(out, log), clean((r.stdout || '') + (r.stderr || '')));
  if (r.status !== 0 || r.error) throw Error(`${path.basename(exe)} failed; ${log || ''}`);
  return r.stdout.trim();
}
env.UPLOAD_DIR=path.join(out,'synthetic-uploads');env.SCOPE_STATE=path.join(out,'SCOPE_STATE.json');
for(const k of Object.keys(env))if(k.startsWith('MINIO_')||k.startsWith('COLLABORATION_MINIO'))delete env[k];

(async()=>{let owned,legacy;
try {
 const files=run('git',['ls-files','--cached','--others','--exclude-standard']).split('\n').filter(Boolean),hashes=run('git',['hash-object','--stdin-paths'],undefined,files.join('\n')+'\n').split('\n');save('SOURCE_BLOBS.json',Object.fromEntries(files.map((p,i)=>[p,hashes[i]])));
 owned=run('docker',['run','-d','--rm','--pull=never','--name',name,'--label','tahili.mission=v1-scope','--memory','768m','--cpus','2','--tmpfs','/var/lib/postgresql/data:rw,size=512m','-p','127.0.0.1:45432:5432','-e','POSTGRES_USER=acceptance','-e','POSTGRES_PASSWORD','-e','POSTGRES_DB='+database,'sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea'],'DOCKER_RUN.log');
 const info=JSON.parse(run('docker',['inspect',owned]))[0];if(info.Name!=='/'+name||info.Mounts.some(m=>m.Type==='volume')||info.NetworkSettings.Ports['5432/tcp'][0].HostIp!=='127.0.0.1')throw Error('Isolation violation');save('ISOLATION.json',{name,owned,tmpfs:true,loopbackOnly:true,qaAccess:false});
 let ready=false;for(let i=0;i<40;i++){if(cp.spawnSync('docker',['exec',owned,'pg_isready','-h','127.0.0.1','-U','acceptance'],{windowsHide:true}).status===0){ready=true;break;}Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,250);}if(!ready)throw Error('PG not ready');
 const migrations=fs.readdirSync(path.join(root,'prisma/migrations')).filter(n=>fs.existsSync(path.join(root,'prisma/migrations',n,'migration.sql')));
 run(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],'FRESH_INSTALL.log');save('FRESH_INSTALL.json',{status:'PASS',migrations,actualMigrateDeploy:true});
 if(process.argv[3]!=='scope-only'){
 const secondary='legacy_'+id;run('docker',['exec',owned,'createdb','-U','acceptance',secondary],'LEGACY_CREATEDB.log');const schema=path.join(out,'SUPPORTED_BASE.prisma');fs.writeFileSync(schema,run('git',['show','3d88c3b:prisma/schema.prisma']));
 const ddl=run(process.execPath,['node_modules/prisma/build/index.js','migrate','diff','--from-empty','--to-schema-datamodel',schema,'--script']);run('docker',['exec','-i',owned,'psql','-U','acceptance','-d',secondary,'-v','ON_ERROR_STOP=1'],'SUPPORTED_DDL.log',ddl);
 const {PrismaClient}=require(path.join(root,'node_modules/@prisma/client'));legacy=new PrismaClient({datasources:{db:{url:env.DATABASE_URL.replace('/'+database,'/'+secondary)}}});
 const p=await legacy.patient.create({data:{fullName:'SCOPE SYNTHETIC historical'}}),c=await legacy.center.create({data:{name:'SCOPE SYNTHETIC legacy center'}});
 await legacy.$executeRawUnsafe('INSERT INTO "CareStage" (id,"patientId",station,"responsibleRole","responsibilityScope",status,sequence,"updatedAt") VALUES (\'scope-legacy-service\',$1,\'legacy service\',\'ACCOUNTANT\',\'SERVICE\',\'WAITING\',0,NOW()),(\'scope-legacy-center\',$1,\'legacy center\',\'HEAD_THERAPIST\',\'CENTER\',\'CONFIRMED\',1,NOW())',p.id);
 for(const status of ['ACTIVE','COMPLETED'])await legacy.$executeRawUnsafe('INSERT INTO center_programs(id,"centerId","patientId","serviceType",status,"updatedAt") VALUES ($1,$2,$3,\'PSYCHOLOGICAL\',$4::"CenterProgramStatus",NOW())','scope-legacy-'+status,c.id,p.id,status);
 const before={stages:await legacy.$queryRawUnsafe('SELECT to_jsonb(s) AS row FROM "CareStage" s ORDER BY id'),programs:await legacy.$queryRawUnsafe('SELECT to_jsonb(s) AS row FROM center_programs s ORDER BY id')};
 run('docker',['exec','-i',owned,'psql','-U','acceptance','-d',secondary,'-v','ON_ERROR_STOP=1'],'ADDITIVE_MIGRATION.log',fs.readFileSync(path.join(root,'prisma/migrations/20261027150000_v1_service_and_consent/migration.sql'),'utf8'));
 const after={stages:await legacy.$queryRawUnsafe('SELECT to_jsonb(s) - ARRAY[\'serviceAuthorityId\',\'serviceAssignmentId\',\'serviceAssignedById\'] AS row FROM "CareStage" s ORDER BY id'),programs:await legacy.$queryRawUnsafe('SELECT to_jsonb(s) AS row FROM center_programs s ORDER BY id')};
 if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Legacy values changed');if(await legacy.patientConsent.count()||await legacy.serviceResponsibility.count())throw Error('Unexpected backfill');save('ADDITIVE_PROOF.json',{status:'PASS',base:'3d88c3b',before,after,noBackfill:true});await legacy.$disconnect();legacy=null;
 }
 const batches=[['SCOPE',['tests/integration/v1-scope-closure-db.test.ts'],null],['REGRESSION',['tests/integration/v1-clinical-db.test.ts','tests/integration/center-stage-completion-db.test.ts'],'CENTER positive|END positive|actual resident session edit|SERVICE historical|preserves legitimate named specialist review'],['UNIT',['tests/unit/permission-store.test.ts','tests/unit/perms.test.ts','tests/unit/care-stage-controls.test.tsx','tests/unit/collaboration-rules.test.ts'],null]];
 for(const[key,include,filter]of batches){if(process.argv[3]==='scope-only'&&key!=='SCOPE')continue;const config=path.join(out,key+'.config.mjs');fs.writeFileSync(config,"import {defineConfig} from 'vitest/config';import path from 'node:path';export default defineConfig({test:{environment:'node',include:"+JSON.stringify(include)+",fileParallelism:false,testTimeout:30000},resolve:{alias:{'@':path.resolve('src')}}});");const args=['node_modules/vitest/vitest.mjs','run','--config',config,'--reporter=json','--outputFile='+path.join(out,key+'_RESULTS.json')];const selected=key==='SCOPE'&&process.argv[4]?process.argv[4]:filter;if(selected)args.push('-t',selected);run(process.execPath,args,key+'.log');}
 run(process.execPath,['node_modules/typescript/bin/tsc','--noEmit','--incremental','false'],'TYPESCRIPT.log');save('RESULT.json',{status:'PASS',sourceAtRun:run('git',['rev-parse','HEAD']),syntheticOnly:true,scanner:'Controlled TCP INSTREAM fixture; not live ClamAV signatures'});console.log('Scoped validation PASS');
}catch(e){save('ERROR.json',{message:clean(e.message)});console.log('Scoped validation failed; inspect sanitized evidence');process.exitCode=1;}
finally{if(legacy)await legacy.$disconnect();if(owned){const i=JSON.parse(run('docker',['inspect',owned]))[0];if(i.Name!=='/'+name||i.Config.Labels['tahili.mission']!=='v1-scope')throw Error('Refusing stop');run('docker',['stop',owned],'STOP.log');}save('PRESERVATION.json',{syntheticDatabaseStopped:!!owned,qaAccess:false,productionAccess:false,githubMutation:false});}
})();
