/** Match only fixed frozen prompt contracts. Never inspect the item, gold label or answer. */
export function schemaFor(system: string): Record<string, unknown> | undefined {
  let properties: Record<string, unknown> | undefined;
  if (system.includes('string fields final_answer and quote')) {
    properties={final_answer:{type:'string'},quote:{type:'string'}};
  } else if (system.startsWith('You are grading output according to a user-specified rubric.')) {
    properties={reason:{type:'string'},pass:{type:'boolean'},score:{type:'number'}};
  } else if (system.startsWith('You verify final answers to math and logic questions.')) {
    properties={pass:{type:'boolean'},reason:{type:'string'}};
  }
  return properties ? {type:'object',properties,required:Object.keys(properties),additionalProperties:false} : undefined;
}
