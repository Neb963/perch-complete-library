# Native binding guide

Native aliases must be declared in `main.pjs`, selected explicitly for each required capability. The library **never** imports native plugins directly from JavaScript module initialization and never discovers plugin aliases with an uncontrolled `root` scan. Use [Build API](../api/build.md) to enumerate allowed profiles and generate the import lines. Application code injects the selected function or host object into binders.

Verify the exact native option and callback shape for the selected Perchance environment. Historical reports cover disposable editor preview; saved/public and external identity semantics can differ. A callback may arrive long after the initial UI paint, and iframe DOM is cross-origin. Handle all absent/throwing/malformed/reordered native events. Avoid provider actions during boot, and explicitly bound text/image generation.

See [Qualification](../qualification.md) for the evidence boundary.
