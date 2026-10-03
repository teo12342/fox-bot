import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateManifest,artifactFor} from '../lib/releases.mjs';
test('unpublished artifacts never become download links',()=>{const m=validateManifest({schemaVersion:1,version:'0.1.0',artifacts:[],gates:[]});assert.equal(artifactFor(m,'windows','x64','exe'),undefined)});
test('rejects untrusted download origins and invalid checksums',()=>{const a={platform:'windows',arch:'x64',format:'exe',url:'https://evil.example/a.exe',sha256:'a'.repeat(64),size:99};assert.throws(()=>validateManifest({schemaVersion:1,version:'1',artifacts:[a],gates:[]}));a.url='https://github.com/owner/fox/releases/download/v1/a.exe';assert.doesNotThrow(()=>validateManifest({schemaVersion:1,version:'1',artifacts:[a],gates:[]}));a.sha256='wrong';assert.throws(()=>validateManifest({schemaVersion:1,version:'1',artifacts:[a],gates:[]}))});
