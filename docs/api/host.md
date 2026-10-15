# Host environment API

`bindHostEnvironment(config, runtime)` accepts a caller-supplied snapshot of generator identity and URL fields. It returns `generatorIdentity()`, `readUrlState(allowedQueryKeys?)`, `canonicalShareUrl(parts?)`, and `replaceUrlState(parts)`. Use the actual iframe origin in preview, never assume the parent editor URL is the generator URL.

Saved/public canonical link claims require explicit saved-environment observation evidence; unsaved or unknown targets remain typed as such. Query/hash mutations are not a durable storage substitute. `validateImageUrlStrict()` rejects unsafe/nonconforming URLs.
