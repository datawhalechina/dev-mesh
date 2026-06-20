const mod = await import('zod'); console.log(Object.keys(mod).slice(0, 40).join(',')); console.log('z', typeof mod.z, typeof mod.z?.object, 'default', typeof mod.default, typeof mod.default?.object);
