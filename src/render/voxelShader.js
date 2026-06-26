import * as THREE from 'three';

let color = (v) => new THREE.Color(v.slice(0, -2))
export const VoxelShader = {
    uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib['fog'],
        {
            u_atlas: { value: null },
            u_blockFaces: { value: new Float32Array(32 * 6) },
            u_time: { value: 0.0 },
            u_grassColor: { value: color("#7eff87ff") },
            u_waterColor: { value: color("#3f76e4ff") },
            u_foliageColor: { value: color("#88ca76ff") },
            u_blockAnims: { value: new Float32Array(32 * 6) },
            u_blockTints: { value: new Float32Array(32 * 6) }
        }
    ]),

    vertexShader: `
        #include <fog_pars_vertex>

        attribute vec3 a_instanceGrid;  // [x, startY, z]
        attribute vec2 a_instanceScale; // [height, blockType]
        attribute float a_instanceFaces;
        
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        varying float vBlockType;

        void main() {
            float ix = a_instanceGrid.x;
            float iy = a_instanceGrid.y;
            float iz = a_instanceGrid.z;
            float iheight = a_instanceScale.x;
            vBlockType = a_instanceScale.y;

            int mask = int(a_instanceFaces);
            bool visible = true;
            if (normal.x > 0.5) visible = (mask & 1) != 0;
            else if (normal.x < -0.5) visible = (mask & 2) != 0;
            else if (normal.y > 0.5) visible = (mask & 4) != 0;
            else if (normal.y < -0.5) visible = (mask & 8) != 0;
            else if (normal.z > 0.5) visible = (mask & 16) != 0;
            else if (normal.z < -0.5) visible = (mask & 32) != 0;

            vec3 transformed = position;
            if (!visible) {
                transformed = vec3(0.0);
            } else {
                transformed.y *= iheight;
                transformed.x += ix;
                transformed.y += iy;
                transformed.z += iz;
            }

            vWorldPos = transformed;
            vNormal = normal;

            vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
            gl_Position = projectionMatrix * mvPosition;

            #include <fog_vertex>
        }
    `,

    fragmentShader: `
        #include <fog_pars_fragment>

        uniform sampler2D u_atlas;
        uniform float u_blockFaces[192]; // 32 types * 6 faces
        uniform float u_time;
        uniform vec3 u_grassColor;
        uniform vec3 u_waterColor;
        uniform vec3 u_foliageColor;
        uniform float u_blockAnims[192];
        uniform float u_blockTints[192];

        varying vec3 vWorldPos;
        varying vec3 vNormal;
        varying float vBlockType;

        void main() {
            int blockType = int(vBlockType+.5);
            if (blockType == 0) discard; // Air

            // Determine which face we are rendering based on normal
            int faceIndex = 0;
            vec2 localUV = vec2(0.0);

            if (vNormal.y > 0.5) {
                faceIndex = 2; // +Y (Top)
                localUV = vWorldPos.xz;
            } else if (vNormal.y < -0.5) {
                faceIndex = 3; // -Y (Bottom)
                localUV = vec2(vWorldPos.x, -vWorldPos.z);
            } else if (vNormal.x > 0.5) {
                faceIndex = 0; // +X (Right)
                localUV = vec2(-vWorldPos.z, vWorldPos.y);
            } else if (vNormal.x < -0.5) {
                faceIndex = 1; // -X (Left)
                localUV = vec2(vWorldPos.z, vWorldPos.y);
            } else if (vNormal.z > 0.5) {
                faceIndex = 4; // +Z (Front)
                localUV = vec2(vWorldPos.x, vWorldPos.y);
            } else {
                faceIndex = 5; // -Z (Back)
                localUV = vec2(-vWorldPos.x, vWorldPos.y);
            }

            // Get tile index in atlas
            int arrayIdx = blockType * 6 + faceIndex;
            float tileIndex = u_blockFaces[arrayIdx];
            
            // Animation handling
            float animCount = u_blockAnims[arrayIdx];
            if (animCount > 1.1) {
                tileIndex += mod(floor(u_time * 12.0), animCount);
            }

            // Resolve (tx, ty) in 41x41 atlas
            float atlasCols = 41.0;
            float tx = mod(tileIndex, atlasCols);
            float ty = floor(tileIndex / atlasCols);

            // Invert ty for WebGL space (0 at bottom, 40 at top)
            float tyWebGL = 40.0 - ty;

            // Dimensions in UV space
            float tileSize = 64.0 / 2624.0;
            float bleed = 6.0 / 2624.0;
            float interior = 52.0 / 2624.0;

            // Map localUV to padded interior region
            // Use fract to repeat texture every 1x1 block face
            vec2 uvInTile = vec2(
                bleed + fract(localUV.x) * interior,
                bleed + fract(localUV.y) * interior
            );

            // Final atlas UV coordinates
            vec2 finalUV = vec2(tx, tyWebGL) * tileSize + uvInTile;

            // Sample texture using explicit gradients to prevent mipmap selection spikes at boundaries
            vec4 texColor = textureGrad(u_atlas, finalUV, dFdx(localUV) * interior, dFdy(localUV) * interior);

            // Alpha test based transparency (glass and leaves)
            if (texColor.a < 0.2) discard;

            // Directional shadowing for depth perception
            vec3 diffuse = texColor.rgb;
            
            // Color tinting for biome/material mapping
            float tintType = u_blockTints[arrayIdx];
            if (tintType > 0.5 && tintType < 1.5) {
                diffuse *= u_grassColor;
            } else if (tintType > 1.5 && tintType < 2.5) {
                diffuse *= u_waterColor;
            } else if (tintType > 2.5 && tintType < 3.5) {
                diffuse *= u_foliageColor;
            }

            if (vNormal.y > 0.5) {
                diffuse *= 1.1; // Bright top
            } else if (vNormal.y < -0.5) {
                diffuse *= 0.6; // Dark bottom
            } else if (abs(vNormal.x) > 0.5) {
                diffuse *= 0.85; // Medium side
            } else if (abs(vNormal.z) > 0.5) {
                diffuse *= 0.95; // Medium side
            }

            float finalAlpha = texColor.a;
            if (tintType > 1.5 && tintType < 2.5) {
                finalAlpha = 0.8;
            }
            gl_FragColor = vec4(diffuse, finalAlpha);

            #include <fog_fragment>
        }
    `
};
