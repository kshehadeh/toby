import CommonCrypto
import Foundation

/// scrypt (RFC 7914). CryptoKit has no scrypt; this matches Node's
/// `crypto.scryptSync`, which the daemon used for sync and backup files.
public enum Scrypt {
	public enum Failure: Error, Sendable {
		case invalidParameters
		case derivationFailed
	}

	public static func derive(password: Data, salt: Data, n: Int, r: Int, p: Int, keyLength: Int) throws -> Data {
		guard n > 1, n & (n - 1) == 0, r > 0, p > 0, keyLength > 0 else { throw Failure.invalidParameters }
		let blockSize = 128 * r
		var b = try pbkdf2(password: password, salt: salt, length: p * blockSize)
		var x = [UInt32](repeating: 0, count: 32 * r)
		var v = [UInt32](repeating: 0, count: 32 * r * n)
		var y = [UInt32](repeating: 0, count: 32 * r)
		b.withUnsafeMutableBytes { raw in
			let bytes = raw.bindMemory(to: UInt8.self)
			for chunk in 0 ..< p {
				let base = chunk * blockSize
				for i in 0 ..< 32 * r {
					let o = base + i * 4
					x[i] = UInt32(bytes[o]) | UInt32(bytes[o + 1]) << 8 | UInt32(bytes[o + 2]) << 16 | UInt32(bytes[o + 3]) << 24
				}
				roMix(&x, &v, &y, n: n, r: r)
				for i in 0 ..< 32 * r {
					let o = base + i * 4
					bytes[o] = UInt8(truncatingIfNeeded: x[i])
					bytes[o + 1] = UInt8(truncatingIfNeeded: x[i] >> 8)
					bytes[o + 2] = UInt8(truncatingIfNeeded: x[i] >> 16)
					bytes[o + 3] = UInt8(truncatingIfNeeded: x[i] >> 24)
				}
			}
		}
		return try pbkdf2(password: password, salt: b, length: keyLength)
	}

	static func pbkdf2(password: Data, salt: Data, length: Int) throws -> Data {
		var output = Data(count: length)
		let status = output.withUnsafeMutableBytes { out in
			password.withUnsafeBytes { pass in
				salt.withUnsafeBytes { saltBytes in
					CCKeyDerivationPBKDF(
						CCPBKDFAlgorithm(kCCPBKDF2),
						pass.baseAddress?.assumingMemoryBound(to: CChar.self), password.count,
						saltBytes.baseAddress?.assumingMemoryBound(to: UInt8.self), salt.count,
						CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), 1,
						out.baseAddress?.assumingMemoryBound(to: UInt8.self), length,
					)
				}
			}
		}
		guard status == kCCSuccess else { throw Failure.derivationFailed }
		return output
	}

	static func roMix(_ x: inout [UInt32], _ v: inout [UInt32], _ y: inout [UInt32], n: Int, r: Int) {
		let words = 32 * r
		var scratch = [UInt32](repeating: 0, count: 32)
		x.withUnsafeMutableBufferPointer { xp in
			v.withUnsafeMutableBufferPointer { vp in
				y.withUnsafeMutableBufferPointer { yp in
					scratch.withUnsafeMutableBufferPointer { tp in
						let xb = xp.baseAddress!, vb = vp.baseAddress!, yb = yp.baseAddress!, tb = tp.baseAddress!
						for i in 0 ..< n {
							(vb + i * words).update(from: xb, count: words)
							blockMix(xb, yb, tb, r: r)
						}
						for _ in 0 ..< n {
							let j = Int(xb[(2 * r - 1) * 16] & UInt32(n - 1))
							let vj = vb + j * words
							for k in 0 ..< words { xb[k] ^= vj[k] }
							blockMix(xb, yb, tb, r: r)
						}
					}
				}
			}
		}
	}

	/// BlockMix with Salsa20/8; result written back into `b`. `t` holds 32 words of scratch.
	@inline(__always)
	static func blockMix(_ b: UnsafeMutablePointer<UInt32>, _ y: UnsafeMutablePointer<UInt32>, _ t: UnsafeMutablePointer<UInt32>, r: Int) {
		t.update(from: b + (2 * r - 1) * 16, count: 16)
		for i in 0 ..< 2 * r {
			let block = b + i * 16
			for k in 0 ..< 16 { t[k] ^= block[k] }
			salsa20_8(t, work: t + 16)
			// Even blocks go to the first half, odd blocks to the second.
			(y + (i % 2 == 0 ? i / 2 : r + i / 2) * 16).update(from: t, count: 16)
		}
		b.update(from: y, count: 32 * r)
	}

	@inline(__always)
	static func rotl(_ a: UInt32, _ b: UInt32) -> UInt32 { (a << b) | (a >> (32 - b)) }

	@inline(__always)
	static func salsa20_8(_ block: UnsafeMutablePointer<UInt32>, work x: UnsafeMutablePointer<UInt32>) {
		x.update(from: block, count: 16)
		for _ in stride(from: 0, to: 8, by: 2) {
			x[4] ^= rotl(x[0] &+ x[12], 7); x[8] ^= rotl(x[4] &+ x[0], 9)
			x[12] ^= rotl(x[8] &+ x[4], 13); x[0] ^= rotl(x[12] &+ x[8], 18)
			x[9] ^= rotl(x[5] &+ x[1], 7); x[13] ^= rotl(x[9] &+ x[5], 9)
			x[1] ^= rotl(x[13] &+ x[9], 13); x[5] ^= rotl(x[1] &+ x[13], 18)
			x[14] ^= rotl(x[10] &+ x[6], 7); x[2] ^= rotl(x[14] &+ x[10], 9)
			x[6] ^= rotl(x[2] &+ x[14], 13); x[10] ^= rotl(x[6] &+ x[2], 18)
			x[3] ^= rotl(x[15] &+ x[11], 7); x[7] ^= rotl(x[3] &+ x[15], 9)
			x[11] ^= rotl(x[7] &+ x[3], 13); x[15] ^= rotl(x[11] &+ x[7], 18)
			x[1] ^= rotl(x[0] &+ x[3], 7); x[2] ^= rotl(x[1] &+ x[0], 9)
			x[3] ^= rotl(x[2] &+ x[1], 13); x[0] ^= rotl(x[3] &+ x[2], 18)
			x[6] ^= rotl(x[5] &+ x[4], 7); x[7] ^= rotl(x[6] &+ x[5], 9)
			x[4] ^= rotl(x[7] &+ x[6], 13); x[5] ^= rotl(x[4] &+ x[7], 18)
			x[11] ^= rotl(x[10] &+ x[9], 7); x[8] ^= rotl(x[11] &+ x[10], 9)
			x[9] ^= rotl(x[8] &+ x[11], 13); x[10] ^= rotl(x[9] &+ x[8], 18)
			x[12] ^= rotl(x[15] &+ x[14], 7); x[13] ^= rotl(x[12] &+ x[15], 9)
			x[14] ^= rotl(x[13] &+ x[12], 13); x[15] ^= rotl(x[14] &+ x[13], 18)
		}
		for i in 0 ..< 16 { block[i] = block[i] &+ x[i] }
	}
}
