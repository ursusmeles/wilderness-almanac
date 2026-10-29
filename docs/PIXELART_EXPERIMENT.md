# Pixelart evergreen experiment

The `pixelart` branch replaces evergreen crowns with solid, stepped 3D geometry. It uses the reference's broad pixel clusters and tiered silhouette as visual direction, with original generated forms. Deciduous trees and other map props retain their existing meshes.

`rendering/pixel-evergreens.js` samples the original broad and tall conifer envelopes into small voxel volumes, then merges adjacent exposed faces into rectangles. Eight detail-seed styles per variant vary branch edges and lean. The existing prop position, rotation, scale, trunk, crown height, temperature and foliage tone remain in use. World generation, dressing descriptors, reservations, locks and export formats are unchanged.

Foliage uses six tones derived from the existing dark, middle and light palette roles. Stepped needle fans wrap around branch tiers, connecting darker hanging fringes, middle tones and small highlights into deliberate pixel clusters. The pattern is part of the exposed voxel faces, so it stays attached to the solid crown from every viewing angle. Each tier tapers slightly to separate branch layers.

The crowns use the same rough, lit materials as other foliage and both cast and receive scene shadows. Time-of-day lighting changes their shading, alongside the existing palette changes, night colouring, fog grayscale and wind deformation. Geometry is batched and disposed through the normal map lifecycle; the crown cache holds numeric templates only. The trees are volumetric meshes, with normal depth occlusion and geometry-based picking, rather than billboards or image cutouts.

The stepped surfaces contain more geometry than the low-poly cones. Review dense forests and physical-phone performance before merging. The approved renderer fixtures still describe the low-poly presentation; refresh those snapshots only after accepting the new look. Keep this experiment off `main` until visual approval.
