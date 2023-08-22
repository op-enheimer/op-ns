/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
    and,
    assert,
    bsv,
    ByteString,
    ContractTransaction,
    hash256,
    int2ByteString,
    len,
    lshift,
    method,
    MethodCallOptions,
    OpCode,
    prop,
    reverseByteString,
    rshift,
    SigHash,
    SmartContract,
    toByteString,
    Utils,
} from 'scrypt-ts'

export class OpNS extends SmartContract {
    @prop()
    readonly tld: ByteString

    @prop()
    readonly difficulty: bigint

    @prop(true)
    id: ByteString

    @prop(true)
    claimed: bigint

    @prop(true)
    domain: ByteString

    @prop(true)
    pow: ByteString

    constructor(tld: ByteString, difficulty: bigint) {
        super(...arguments)
        this.tld = tld
        this.difficulty = difficulty
        this.id = toByteString('')
        this.claimed = 0n
        this.domain = toByteString('')
        this.pow = toByteString('')
    }

    @method(SigHash.ANYONECANPAY_ALL)
    public mint(
        char: bigint,
        nonce: ByteString,
        lock: ByteString,
        trailingOutputs: ByteString
    ) {
        if (len(this.id) == 0n) {
            this.id =
                this.ctx.utxo.outpoint.txid +
                int2ByteString(this.ctx.utxo.outpoint.outputIndex, 4n)
        }
        this.pow = this.validatePOW(char, nonce)
        this.claimed = this.validateChar(char)
        const selfOutput = this.buildStateOutput(1n)

        this.claimed = 0n
        this.domain = this.domain + int2ByteString(char)
        const spawnOutput = this.buildStateOutput(1n)

        const tokenOutput = Utils.buildOutput(this.buildInscription(lock), 1n)

        const outputs: ByteString =
            selfOutput + spawnOutput + tokenOutput + trailingOutputs
        assert(
            hash256(outputs) == this.ctx.hashOutputs,
            'invalid outputs hash '
            // + selfOutput + ' ' + spawnOutput + ' ' + tokenOutput + ' ' + trailingOutputs
        )
    }

    @method()
    validatePOW(char: bigint, nonce: ByteString): ByteString {
        const pow = hash256(this.pow + int2ByteString(char) + nonce)
        // console.log('pow: ', pow)
        const test = rshift(Utils.fromLEUnsigned(pow), 256n - this.difficulty)
        assert(test == 0n, pow + ' invalid pow')
        return pow
    }

    @method()
    validateChar(char: bigint): bigint {
        // -, 0-9, a-z
        const valid =
            char == 45n ||
            (char >= 48n && char < 58n) ||
            (char >= 97n && char < 123n)
        assert(valid, 'invalid char')
        const mask = lshift(1n, char)
        assert(and(mask, this.claimed) == 0n, 'char already claimed')
        return this.claimed + mask
    }

    @method()
    buildInscription(lock: ByteString): ByteString {
        let domain = this.domain
        if (len(this.tld) > 0n) {
            domain = this.domain + toByteString('.', true) + this.tld
        }
        return (
            lock +
            // OP_FALSE OP_IF OP_DATA3 "ord" OP_1 OP_DATA10 "text/op-ns" OP_0
            toByteString('0063036f7264510a746578742f6f702d6e7300') +
            int2ByteString(len(domain)) +
            domain +
            OpCode.OP_ENDIF +
            OpCode.OP_RETURN +
            int2ByteString(33n) +
            toByteString('1opNSUJVbBc2Vf8LFNSoywGGK4jMcGVrC', true) +
            int2ByteString(36n) +
            this.id
        )
    }

    static mintTxBuilder(
        current: OpNS,
        options: MethodCallOptions<OpNS>,
        char: bigint,
        nonce: ByteString,
        lock: ByteString,
        trailingOutputs: ByteString
    ): Promise<ContractTransaction> {
        const nextInstance = current.next()
        // console.log('current.id: ', current.id)
        nextInstance.pow = nextInstance.validatePOW(char, nonce)
        if (len(current.id) == 0n) {
            nextInstance.id =
                reverseByteString(toByteString(options.fromUTXO!.txId), 32n) +
                int2ByteString(BigInt(options.fromUTXO!.outputIndex), 4n)
        }
        nextInstance.claimed = nextInstance.validateChar(char)
        const selfScript = nextInstance.lockingScript

        nextInstance.claimed = 0n
        nextInstance.domain = nextInstance.domain + int2ByteString(char)
        const spawnScript = nextInstance.lockingScript
        const inscriptionScript = bsv.Script.fromHex(
            nextInstance.buildInscription(lock)
        )

        // console.log('selfScript: ', selfScript.toHex())
        // console.log('spawnScript: ', spawnScript.toHex())
        // console.log('inscriptionScript: ', inscriptionScript.toHex())

        const unsignedTx: bsv.Transaction = new bsv.Transaction()
            // add contract input
            .addInput(current.buildContractInput(options.fromUTXO))
            // build next instance output
            .addOutput(
                new bsv.Transaction.Output({
                    script: selfScript,
                    satoshis: Number(1),
                })
            )
            .addOutput(
                new bsv.Transaction.Output({
                    script: spawnScript,
                    satoshis: Number(1),
                })
            )
            // build payment output
            .addOutput(
                new bsv.Transaction.Output({
                    script: inscriptionScript,
                    satoshis: Number(1),
                })
            )

        if (trailingOutputs) {
            unsignedTx.addOutput(
                bsv.Transaction.Output.fromBufferReader(
                    new bsv.encoding.BufferReader(
                        Buffer.from(trailingOutputs, 'hex')
                    )
                )
            )
        }

        // console.log('unsignedTx: ', unsignedTx.toBuffer().toString('hex'))
        return Promise.resolve({
            tx: unsignedTx,
            atInputIndex: 0,
            nexts: [],
        })
    }
}
