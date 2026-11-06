import React,{useState,useEffect,useCallback} from 'react';
import {render,act} from '@testing-library/react';
import {it,expect} from 'vitest';
import {useGeolocation} from './src/hooks/useGeolocation';
import {useWebSocket} from './src/hooks/useWebSocket';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT=false;
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));

it('PublicTrackingPage pattern: inline onJourneyCompleted + 1s ticking state => WebSocket churn', async()=>{
  let created=0, closed=0;
  class FakeWS{ static OPEN=1; readyState=1; onopen:any; onclose:any; onmessage:any; onerror:any;
    constructor(public url:string){created++; setTimeout(()=>this.onopen&&this.onopen(),0);}
    send(){} close(){closed++; this.readyState=3;} }
  (globalThis as any).WebSocket=FakeWS;
  function Page(){
    const [secs,setSecs]=useState(0); const [ended,setEnded]=useState(false);
    useEffect(()=>{const t=setInterval(()=>setSecs(s=>s+1),1000);return()=>clearInterval(t);},[]);
    const onMessage=useCallback(()=>{},[]);
    useWebSocket({url:'ws://x/ws/track/T',onMessage,onJourneyCompleted:()=>setEnded(true)}); // <- exactly as PublicTrackingPage.tsx:110-114
    return <div>{secs}{String(ended)}</div>;
  }
  render(<Page/>); await sleep(5200);
  console.log(`[PUBLIC WS] in 5.2s: sockets created=${created}, closed=${closed}`);
  expect(created).toBeGreaterThan(3);
});

it('ActiveJourney pattern: literal coord objects + onLocationUpdate => geolocation re-subscription loop', async()=>{
  let getCur=0, watch=0, clear=0, uploads=0;
  const fix=()=>({coords:{latitude:12.97,longitude:77.59,accuracy:10,speed:null,heading:null,altitude:null},timestamp:Date.now()});
  (globalThis as any).navigator.geolocation={
    getCurrentPosition:(ok:any)=>{getCur++; setTimeout(()=>ok(fix()),20);},
    watchPosition:(ok:any)=>{watch++; return watch;},
    clearWatch:()=>{clear++;} };
  function Driver(){
    const [pings,setPings]=useState(0);
    const cb=useCallback(async(p:any)=>{uploads++; setPings(c=>c+1);},[]);
    const {startWatching,stopWatching}=useGeolocation({simulated:false,
      initialCoords:{lat:12.9716,lng:77.5946}, destinationCoords:{lat:12.975,lng:77.598}, // <- fresh literals every render, as ActiveJourney.tsx:157-165
      onLocationUpdate:cb});
    useEffect(()=>{startWatching();return()=>stopWatching();},[startWatching,stopWatching]); // ActiveJourney.tsx:168-171
    return <div>{pings}</div>;
  }
  render(<Driver/>); await sleep(2000);
  console.log(`[DRIVER GPS] in 2s with ONE real fix source: uploads=${uploads}, getCurrentPosition calls=${getCur}, watchPosition calls=${watch}, clearWatch=${clear}`);
  expect(uploads).toBeGreaterThan(5);
});
