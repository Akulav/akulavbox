"use strict";
// Ironveil's saves in the browser: the other half of src/storage.rs. Entries are a key ("profile",
// "run") and a JSON text. They go to this page's localStorage, unless the host page provides
// window.ironveilStorage = { get(key) -> string | null, set(key, value) -> boolean, remove(key) }
// before calling load() (AkulavBox does, to keep them with the player's account).
// The game reads synchronously, so a host keeps the entries in memory and saves them in the background.
(function () {
    const PREFIX = "ironveil:";
    const local = {
        get: function (k) { try { return localStorage.getItem(PREFIX + k); } catch (e) { return null; } },
        set: function (k, v) { try { localStorage.setItem(PREFIX + k, v); return true; } catch (e) { return false; } },
        remove: function (k) { try { localStorage.removeItem(PREFIX + k); } catch (e) { /* storage unavailable */ } },
    };
    const backend = function () { return window.ironveilStorage || local; };
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    // copies, not views: the wasm memory can grow (and move) while the game runs
    const text = function (ptr, len) { return decoder.decode(new Uint8Array(wasm_memory.buffer, ptr, len).slice()); };

    // ironveil_store_len encodes the value once; ironveil_store_read, right after it, copies it out
    let pending = null;
    function encoded(key) {
        if (pending && pending.key === key) return pending.data;
        const v = backend().get(key);
        return v == null ? null : encoder.encode(String(v));
    }

    function ironveil_store_len(kp, kl) {
        const key = text(kp, kl);
        const data = encoded(key);
        pending = data ? { key: key, data: data } : null;
        return data ? data.length : -1;
    }
    function ironveil_store_read(kp, kl, out, outLen) {
        const data = encoded(text(kp, kl));
        pending = null;
        if (!data) return -1;
        const n = Math.min(outLen, data.length);
        new Uint8Array(wasm_memory.buffer, out, n).set(data.subarray(0, n));
        return n;
    }
    function ironveil_store_write(kp, kl, vp, vl) {
        pending = null;
        return backend().set(text(kp, kl), text(vp, vl)) ? 1 : 0;
    }
    function ironveil_store_remove(kp, kl) {
        pending = null;
        backend().remove(text(kp, kl));
    }

    // Quit: a tab can't close itself, so the game offers it only when the host page sets
    // window.ironveilQuit (a function that leaves the game, e.g. back to the host's own pages)
    function ironveil_can_quit() { return typeof window.ironveilQuit === "function" ? 1 : 0; }
    function ironveil_quit() { if (typeof window.ironveilQuit === "function") window.ironveilQuit(); }

    miniquad_add_plugin({
        register_plugin: function (importObject) {
            importObject.env.ironveil_can_quit = ironveil_can_quit;
            importObject.env.ironveil_quit = ironveil_quit;
            importObject.env.ironveil_store_len = ironveil_store_len;
            importObject.env.ironveil_store_read = ironveil_store_read;
            importObject.env.ironveil_store_write = ironveil_store_write;
            importObject.env.ironveil_store_remove = ironveil_store_remove;
        },
        version: 1,
        name: "ironveil_storage",
    });
})();
