import assert from "node:assert/strict";
import { once } from "node:events";
import { chmod, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { writeAsar } from "../desktop/scripts/release/fixtures.mjs";
import { steamProduct } from "../desktop/scripts/release/lib.mjs";
import { makeServer, prepare, renderAppVdf, stage, verifyDepot } from "./steam-local.mjs";

async function fixture(root, target) {
  const product = steamProduct(target);
  const app = join(root,product.productName+".app");
  const resources = join(app,"Contents","Resources");
  await mkdir(join(resources,"client-bundle","en"),{recursive:true});
  await mkdir(join(app,"Contents","MacOS"),{recursive:true});
  await writeFile(join(app,"Contents","MacOS",product.productName),"fixture");
  await chmod(join(app,"Contents","MacOS",product.productName),0o755);
  await writeFile(join(resources,"client-bundle","en","index.html"),"fixture");
  await writeFile(join(resources,"libsteam_api.dylib"),"fixture");
  writeAsar(join(resources,"app.asar"),{"package.json":JSON.stringify({distributionChannel:target,steamBuild:true,steamDemo:target==="steam-demo",steamAppId:product.appId})});
  return app;
}

test("local staging preserves separate app identities and leaves SetLive empty",async()=>{
  const directory = await mkdtemp(join(tmpdir(),"tiao-local-"));
  try {
    for (const target of ["steam","steam-demo"]) {
      const root = join(directory,target);
      const app = await fixture(directory,target);
      await stage(target,"macos",app,root);
      const path = await prepare(target,["macos"],root,52917);
      const vdf = await readFile(path,"utf8");
      assert.ok(vdf.includes(`"appid" "${steamProduct(target).appId}"`));
      assert.ok(vdf.includes('"setlive" ""'));
      assert.ok(vdf.includes(`"${steamProduct(target).depots.macos}"`));
      assert.equal(await readFile(join(root,"steam_dev.cfg"),"utf8"),'@LocalContentServer "127.0.0.1:52917"\n');
      await writeFile(join(root,"depots","macos","steam_appid.txt"),"480");
      await assert.rejects(verifyDepot(target,"macos",join(root,"depots","macos")));
    }
  } finally { await rm(directory,{recursive:true,force:true}); }
});

test("invalid input cannot replace the last usable local stage",async()=>{
  const directory = await mkdtemp(join(tmpdir(),"tiao-local-invalid-"));
  try {
    const root = join(directory,"work");
    const demo = await fixture(directory,"steam-demo");
    const staged = await stage("steam-demo","macos",demo,root);
    const full = await fixture(directory,"steam");
    await assert.rejects(stage("steam-demo","macos",full,root),/matching game/);
    await verifyDepot("steam-demo","macos",staged);
    await assert.rejects(stage("steam-demo","macos",join(staged,"Tiao Demo.app"),root),/overlaps/);
    writeAsar(join(demo,"Contents","Resources","app.asar"),{"package.json":JSON.stringify({distributionChannel:"steam-demo",steamBuild:true,steamDemo:true,steamAppId:5035580})});
    await assert.rejects(stage("steam-demo","macos",demo,root),/appid/);
    await verifyDepot("steam-demo","macos",staged);
  } finally { await rm(directory,{recursive:true,force:true}); }
});

test("macOS framework links remain relative and cannot point outside the staged depot",async()=>{
  const directory = await mkdtemp(join(tmpdir(),"tiao-local-links-"));
  try {
    const app = await fixture(directory,"steam-demo");
    const framework = join(app,"Contents","Frameworks","Example.framework");
    await mkdir(join(framework,"Versions","A"),{recursive:true});
    await writeFile(join(framework,"Versions","A","Example"),"framework fixture");
    await symlink("A",join(framework,"Versions","Current"));
    await symlink("Versions/Current/Example",join(framework,"Example"));
    const root = join(directory,"work");
    const depot = await stage("steam-demo","macos",app,root);
    const stagedFramework = join(depot,"Tiao Demo.app","Contents","Frameworks","Example.framework");
    assert.equal(await readlink(join(stagedFramework,"Versions","Current")),"A");
    assert.equal(await readlink(join(stagedFramework,"Example")),"Versions/Current/Example");
    assert.equal(await readFile(join(stagedFramework,"Example"),"utf8"),"framework fixture");
    await writeFile(join(directory,"private"),"must stay outside");
    await symlink(join(directory,"private"),join(framework,"escape"));
    await assert.rejects(stage("steam-demo","macos",app,root),/symlink outside/);
    await verifyDepot("steam-demo","macos",depot);
  } finally { await rm(directory,{recursive:true,force:true}); }
});

test("local manifest rejects unknown targets, platforms and duplicate depots",()=>{
  assert.throws(()=>renderAppVdf("steam-demo",[],"/tmp/work"));
  assert.throws(()=>renderAppVdf("steam-demo",["macos","macos"],"/tmp/work"));
  assert.throws(()=>renderAppVdf("unknown",["macos"],"/tmp/work"));
  assert.throws(()=>renderAppVdf("steam-demo",["android"],"/tmp/work"));
});

test("local server exposes only its chunk directory, including symlink escape protection",async()=>{
  const root = await mkdtemp(join(tmpdir(),"tiao-local-http-"));
  const server = makeServer(root);
  try {
    await mkdir(join(root,"htdocs"));
    await writeFile(join(root,"htdocs","chunk"),"encrypted chunk");
    await writeFile(join(root,"private"),"private");
    await symlink(join(root,"private"),join(root,"htdocs","escape"));
    server.listen(0,"127.0.0.1");
    await once(server,"listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal(await (await fetch(base+"/chunk")).text(),"encrypted chunk");
    assert.equal((await fetch(base+"/chunk",{method:"HEAD"})).headers.get("content-length"),"15");
    assert.equal((await fetch(base+"/escape")).status,404);
    assert.equal((await fetch(base+"/%2e%2e/private")).status,404);
    assert.equal((await fetch(base+"/chunk",{method:"POST"})).status,405);
  } finally {
    await new Promise(resolve=>server.close(resolve));
    await rm(root,{recursive:true,force:true});
  }
});

test("Windows and Linux stage unpacked apps with the selected demo identity",async()=>{
  const directory = await mkdtemp(join(tmpdir(),"tiao-local-portable-"));
  try {
    for (const platform of ["windows","linux"]) {
      const source = join(directory,"source",platform);
      const resources = join(source,"resources");
      await mkdir(join(resources,"client-bundle","en"),{recursive:true});
      const executable = join(source,platform === "windows" ? "Tiao Demo.exe" : "tiao-demo");
      await writeFile(executable,"fixture");
      await chmod(executable,0o755);
      await writeFile(join(resources,"client-bundle","en","index.html"),"fixture");
      await writeFile(join(resources,platform === "windows" ? "steam_api64.dll" : "libsteam_api.so"),"fixture");
      writeAsar(join(resources,"app.asar"),{"package.json":JSON.stringify({distributionChannel:"steam-demo",steamBuild:true,steamDemo:true,steamAppId:5491870})});
      const root = join(directory,"work");
      const depot = await stage("steam-demo",platform,source,root);
      await verifyDepot("steam-demo",platform,depot);
      await writeFile(join(source,".env.release"),"must not stage");
      await assert.rejects(stage("steam-demo",platform,source,root),/credential/);
      await verifyDepot("steam-demo",platform,depot);
    }
  } finally { await rm(directory,{recursive:true,force:true}); }
});
