/* @flow
 * Transaction history
 */

import { chainContainsAddress } from './discovery';

import type { Output } from 'bitcoinjs-lib';
import type { TransactionInfo, TransactionMap } from './transaction';
import type { Chain } from './discovery';

export type TransactionImpactType = 'incoming' | 'outgoing' | 'internal';
export type TransactionImpact = {
    id: string;                  // tx id
    height: ?number;             // latest known height of the tx info
    timestamp: ?number;          // timestamp of the tx block

    type: TransactionImpactType; // classification of the impact
    value: number;               // immediate impact on the wallet balance
    balance: number;             // estimated wallet balance after the impact

    targets: Array<Output>;      // relevant crediting outputs of the tx

    // TODO: groups targets by address
};

const IMPACT_ORDERING = ['incoming', 'internal', 'outgoing'];

export function deriveImpacts(
    transactions: TransactionMap,
    external: Chain,
    internal: Chain
): Array<TransactionImpact> {

    let impacts = transactions.map((info) => {
        return analyzeTransaction(info, transactions, external, internal);
    });

    impacts.sort(compareByOldestAndType);
    impacts.reduce((prev, info) => {
        if (prev != null) {
            info.balance = prev.balance + info.value;
        } else {
            info.balance = info.value;
        }
        return info;
    }, null);
    impacts.reverse();

    return impacts;
}

export function compareByOldestAndType(
    a: TransactionImpact,
    b: TransactionImpact
): number {
    let ah = (a.height != null ? a.height : Infinity);
    let bh = (b.height != null ? b.height : Infinity);
    return ((ah - bh) || 0) // Infinity - Infinity = NaN
        || (IMPACT_ORDERING.indexOf(a.type) -
            IMPACT_ORDERING.indexOf(b.type));
}

export function analyzeTransaction(
    {id, tx, height, timestamp, inputIds}: TransactionInfo,
    transactions: TransactionMap,
    external: Chain,
    internal: Chain
): TransactionImpact {

    let isExternal = (o) => o.address && chainContainsAddress(external, o.address);
    let isInternal = (o) => o.address && chainContainsAddress(internal, o.address);
    let isCredit = (o) => isExternal(o) || isInternal(o);
    let isDebit = (o) => !isCredit(o);

    let nCredit = 0;
    let nDebit = 0;
    let value = 0;

    // subtract debit impact value
    tx.ins.forEach((i, index) => {
        let o = transactions.getOutput(inputIds[index], i.index);
        if (o && isCredit(o)) {
            value -= o.value;
            nDebit++;
        }
    });

    // add credit impact value
    tx.outs.forEach((o) => {
        if (isCredit(o)) {
            value += o.value;
            nCredit++;
        }
    });

    let targets;
    let type;

    if (nDebit === tx.ins.length && nCredit === tx.outs.length) {
        // within the same account
        type = 'internal';
        targets = [];

    } else if (value > 0) {
        // incoming transaction, targets are either external or internal outputs
        type = 'incoming';
        targets = tx.outs.filter(isExternal);
        if (targets.length === 0) {
            targets = tx.outs.filter(isInternal);
        }

    } else {
        // outgoing transaction, targets are debit outputs
        type = 'outgoing';
        targets = tx.outs.filter(isDebit);
    }

    let balance = 0;

    return {id, height, timestamp, balance, type, targets, value};
}
