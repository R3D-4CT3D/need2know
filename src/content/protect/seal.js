// Protection, last file: removes the helpers core.js shared with the defense files, before any
// page script runs. The defenses keep working through their own closures.
delete window.__wssProtect;
