from pathlib import Path
p=Path('packages/validators/src/frame/driver.ts');s=p.read_text()
s=s.replace('const «ownKeys» = Reflect.ownKeys;', 'const «ownKeys» = Reflect.ownKeys;\nconst «descriptorsOf» = Object.getOwnPropertyDescriptors;',1)
s=s.replace('    const «keysNow» = «ownKeys»(«was».thing);', '    const «descsNow» = «descriptorsOf»(«was».thing);\n    const «keysNow» = «ownKeys»(«descsNow»);',1)
s=s.replace('«sameDescriptor»(«describe»(«was».thing, «keysNow»[«k»]), «was».descs[«k»])', '«sameDescriptor»(«descsNow»[«keysNow»[«k»]], «was».descs[«k»])',1)
p.write_text(s)
