/** Record fetch failure codes without headers, keys, request bodies or speculative billing claims. */
export function errorCodes(error:unknown):{name:string;code?:string;causes:unknown[]} {
 const e=error&&typeof error==='object'?error as any:{};
 const causes=[...(e.cause?[e.cause]:[]),...(Array.isArray(e.errors)?e.errors:[])];
 return {name:typeof e.name==='string'?e.name:'unknown',...(typeof e.code==='string'?{code:e.code}:{}),causes:causes.map(errorCodes)};
}
export function observedFetch(note:(event:unknown)=>void, fetcher:typeof fetch=fetch):typeof fetch {
 return async (url,init)=>{
  let response:Response;
  try {response=await fetcher(url,init);}
  catch(error){note({phase:'fetch',error:errorCodes(error)});throw error;}
  const text=response.text.bind(response);
  response.text=async()=>{try{return await text();}catch(error){note({phase:'response-body',httpStatus:response.status,error:errorCodes(error)});throw error;}};
  return response;
 };
}
