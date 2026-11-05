import os

base = r"c:\Users\Aravind\OneDrive\Desktop\sample tracker"
for d in ["backend", "frontend", "infrastructure", "docs"]:
    full = os.path.join(base, d)
    if not os.path.isdir(full):
        print(f"{d}/ NOT FOUND")
        continue
    count = 0
    for root, dirs, files in os.walk(full):
        dirs[:] = [x for x in dirs if x not in ("node_modules", "__pycache__")]
        for f in files:
            fp = os.path.join(root, f)
            rel = os.path.relpath(fp, base)
            sz = os.path.getsize(fp)
            print(f"  {rel} ({sz}b)")
            count += 1
        if not files and not dirs:
            rel = os.path.relpath(root, base)
            print(f"  {rel}/ (empty)")
    if count == 0:
        print(f"  {d}/ has no files (subdirs may exist)")
