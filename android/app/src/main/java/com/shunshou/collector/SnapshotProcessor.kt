package com.shunshou.collector

object SnapshotProcessor {
    fun process(packageName: String, lines: List<String>, now: Long): PaymentSample? {
        if (packageName !in PaymentParser.supportedPackages || lines.isEmpty()) return null

        val bill = BillParser.parse(lines)
        if (bill != null) {
            return PaymentSample(
                id = "bill:$packageName:$now",
                packageName = packageName,
                title = "账单识别",
                text = lines.joinToString(" ").take(500),
                at = now,
                amountCents = bill.amountCents,
                direction = bill.direction,
                merchant = bill.merchant.ifEmpty {
                    bill.product.ifEmpty { PaymentParser.appName(packageName) }
                },
                source = Source.SHIZUKU,
            )
        }

        val joined = lines.joinToString(" ")
        // 没有交易锚点就不记；菜单、广告、聊天列表一律丢弃，避免污染账本。
        if (!PaymentParser.hasAnchor(joined)) return null
        val parsed = PaymentParser.parse("", joined, packageName)
        val note = if (parsed.amountCents == null) "no_amount" else parsed.note
        return PaymentSample(
            id = "shizuku:$packageName:$now",
            packageName = packageName,
            title = "Shizuku 读屏",
            text = joined.take(500),
            at = now,
            amountCents = parsed.amountCents,
            direction = parsed.direction,
            merchant = parsed.merchant,
            source = Source.SHIZUKU,
            note = note,
        )
    }
}
