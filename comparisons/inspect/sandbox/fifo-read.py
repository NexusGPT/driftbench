import asyncio, os, subprocess, time
from inspect_ai.util._sandbox.local import LocalSandboxEnvironment

async def main():
    env = LocalSandboxEnvironment()
    fifo = os.path.join(env.directory.name, "stream.bin")
    os.mkfifo(fifo)
    # A writer streams 150 MB into the FIFO: past the 100 MB read bound.
    writer = subprocess.Popen(["sh", "-c", f"head -c 157286400 /dev/zero > '{fifo}'"])
    start = time.time()
    try:
        data = await asyncio.wait_for(env.read_file("stream.bin", text=False), timeout=60)
        print(f"theirs read_file returned {len(data)} bytes in {time.time()-start:.1f}s (bound 104857600)")
    except Exception as e:
        print(f"theirs read_file raised {type(e).__name__} after {time.time()-start:.1f}s: {str(e)[:120]}")
    writer.kill()

asyncio.run(main())
