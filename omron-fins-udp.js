module.exports = function (RED) {
    const dgram = require('dgram');

    // Parse address to support bit notation (e.g., "1000.05")
    function parseAddress(address) {
        const addrStr = String(address).trim();
        const parts = addrStr.split('.');

        if (parts.length === 1) {
            return {
                wordAddress: parseInt(parts[0]),
                bitPosition: 0,
                isBitAddress: false
            };
        } else if (parts.length === 2) {
            const wordAddress = parseInt(parts[0]);
            const bitPosition = parseInt(parts[1]);

            if (isNaN(bitPosition) || bitPosition < 0 || bitPosition > 15) {
                throw new Error(`Invalid bit position: ${parts[1]}. Bit position must be between 0 and 15.`);
            }

            return {
                wordAddress: wordAddress,
                bitPosition: bitPosition,
                isBitAddress: true
            };
        } else {
            throw new Error(`Invalid address format: ${address}. Use format like '1000' or '1000.05'`);
        }
    }

    // Extract specific bits from word data buffer
    function extractBitsFromWords(buffer, startBit, bitCount) {
        const bits = [];
        const words = [];

        for (let i = 0; i < buffer.length; i += 2) {
            if (i + 1 < buffer.length) {
                words.push(buffer.readUInt16BE(i));
            }
        }

        for (let i = 0; i < bitCount; i++) {
            const absoluteBitPos = startBit + i;
            const wordIndex = Math.floor(absoluteBitPos / 16);
            const bitInWord = absoluteBitPos % 16;

            if (wordIndex < words.length) {
                const word = words[wordIndex];
                const bitValue = (word >> bitInWord) & 1;
                bits.push(bitValue === 1);
            }
        }

        return bits;
    }

    // Modify specific bits in word buffer
    function modifyBitsInWords(buffer, startBit, bitValues) {
        const words = [];

        for (let i = 0; i < buffer.length; i += 2) {
            if (i + 1 < buffer.length) {
                words.push(buffer.readUInt16BE(i));
            }
        }

        for (let i = 0; i < bitValues.length; i++) {
            const absoluteBitPos = startBit + i;
            const wordIndex = Math.floor(absoluteBitPos / 16);
            const bitInWord = absoluteBitPos % 16;

            if (wordIndex < words.length) {
                const bitValue = bitValues[i];
                const bitNum = (bitValue === true || bitValue === 1 || bitValue === '1') ? 1 : 0;

                if (bitNum === 1) {
                    words[wordIndex] |= (1 << bitInWord);
                } else {
                    words[wordIndex] &= ~(1 << bitInWord);
                }
            }
        }

        for (let i = 0; i < words.length; i++) {
            buffer.writeUInt16BE(words[i], i * 2);
        }

        return buffer;
    }

    function buildReadCommand(dataType, address, count, config, addressInfo) {
        // FINS frame: 10 bytes header + 2 bytes command + 1 byte area + 2 bytes addr + 1 byte bit + 2 bytes count = 18 bytes
        const finsFrame = Buffer.alloc(18);

        // FINS Command frame
        finsFrame.writeUInt8(0x80, 0);   // ICF
        finsFrame.writeUInt8(0x00, 1);   // RSV
        finsFrame.writeUInt8(0x02, 2);   // GCT
        finsFrame.writeUInt8(config.DA1 || 0x00, 3);   // DNA
        finsFrame.writeUInt8(config.DA2 || 0x01, 4);   // DA1
        finsFrame.writeUInt8(0x00, 5);   // DA2
        finsFrame.writeUInt8(config.SA1 || 0x00, 6);   // SNA
        finsFrame.writeUInt8(config.SA2 || 0x00, 7);   // SA1
        finsFrame.writeUInt8(0x00, 8);   // SA2
        finsFrame.writeUInt8(0x00, 9);   // SID

        // Memory area read command
        finsFrame.writeUInt8(0x01, 10);
        finsFrame.writeUInt8(0x01, 11);

        const areaCode = getMemoryAreaCode(dataType);
        finsFrame.writeUInt8(areaCode, 12);
        finsFrame.writeUInt16BE(addressInfo.wordAddress, 13);
        finsFrame.writeUInt8(0x00, 15);

        let wordCount = count;
        if (addressInfo.isBitAddress) {
            const startBit = addressInfo.bitPosition;
            const endBit = startBit + count - 1;
            const startWord = Math.floor(startBit / 16);
            const endWord = Math.floor(endBit / 16);
            wordCount = endWord - startWord + 1;
        }

        finsFrame.writeUInt16BE(wordCount, 16);

        return finsFrame;
    }

    function buildWriteCommand(dataType, address, data, config, addressInfo) {
        const values = Array.isArray(data) ? data : [data];
        const finsFrame = Buffer.alloc(18 + values.length * 2);

        finsFrame.writeUInt8(0x80, 0);
        finsFrame.writeUInt8(0x00, 1);
        finsFrame.writeUInt8(0x02, 2);
        finsFrame.writeUInt8(config.DA1 || 0x00, 3);
        finsFrame.writeUInt8(config.DA2 || 0x01, 4);
        finsFrame.writeUInt8(0x00, 5);
        finsFrame.writeUInt8(config.SA1 || 0x00, 6);
        finsFrame.writeUInt8(config.SA2 || 0x00, 7);
        finsFrame.writeUInt8(0x00, 8);
        finsFrame.writeUInt8(0x00, 9);

        finsFrame.writeUInt8(0x01, 10);
        finsFrame.writeUInt8(0x02, 11);

        const areaCode = getMemoryAreaCode(dataType);
        finsFrame.writeUInt8(areaCode, 12);
        finsFrame.writeUInt16BE(addressInfo.wordAddress, 13);
        finsFrame.writeUInt8(0x00, 15);

        finsFrame.writeUInt16BE(values.length, 16);

        for (let i = 0; i < values.length; i++) {
            finsFrame.writeUInt16BE(values[i], 18 + i * 2);
        }

        return finsFrame;
    }

    function getMemoryAreaCode(dataType) {
        const areas = {
            'CIO': 0xB0,
            'WR': 0xB1,
            'HR': 0xB2,
            'AR': 0xB3,
            'DM': 0x82,
            'EM': 0xA0
        };
        return areas[dataType] || 0x82;
    }

    function parseFinsResponse(data) {
        if (data.length < 14) {
            throw new Error("Invalid FINS response: too short");
        }

        const endCode = data.readUInt16BE(12);
        if (endCode !== 0x0000) {
            throw new Error(`FINS error: ${getFinsErrorDescription(endCode)}`);
        }

        if (data.length > 14) {
            return data.slice(14);
        }

        return null;
    }

    function formatData(buffer, format, addressInfo, bitCount) {
        if (!buffer || buffer.length === 0) {
            return null;
        }

        if (addressInfo && addressInfo.isBitAddress) {
            const bits = extractBitsFromWords(buffer, addressInfo.bitPosition, bitCount || 1);
            return bits.length === 1 ? bits[0] : bits;
        }

        switch (format) {
            case 'array':
                {
                    const values = [];
                    for (let i = 0; i < buffer.length; i += 2) {
                        if (i + 1 < buffer.length) {
                            values.push(buffer.readInt16BE(i));
                        }
                    }
                    return values;
                }
            case 'unsigned':
                {
                    const values = [];
                    for (let i = 0; i < buffer.length; i += 2) {
                        if (i + 1 < buffer.length) {
                            values.push(buffer.readUInt16BE(i));
                        }
                    }
                    return values;
                }
            case 'int32':
                {
                    const values = [];
                    for (let i = 0; i < buffer.length; i += 4) {
                        if (i + 3 < buffer.length) {
                            values.push(buffer.readInt32BE(i));
                        }
                    }
                    return values;
                }
            case 'float32':
                {
                    const values = [];
                    for (let i = 0; i < buffer.length; i += 4) {
                        if (i + 3 < buffer.length) {
                            values.push(buffer.readFloatBE(i));
                        }
                    }
                    return values;
                }
            case 'binary':
                {
                    const values = [];
                    for (let i = 0; i < buffer.length; i += 2) {
                        if (i + 1 < buffer.length) {
                            const word = buffer.readUInt16BE(i);
                            values.push(word.toString(2).padStart(16, '0'));
                        }
                    }
                    return values;
                }
            case 'hex':
                {
                    const values = [];
                    for (let i = 0; i < buffer.length; i += 2) {
                        if (i + 1 < buffer.length) {
                            const word = buffer.readUInt16BE(i);
                            values.push(word.toString(16).toUpperCase().padStart(4, '0'));
                        }
                    }
                    return values;
                }
            case 'ascii':
                {
                    let str = '';
                    for (let i = 0; i < buffer.length; i += 2) {
                        if (i + 1 < buffer.length) {
                            const word = buffer.readUInt16BE(i);
                            const char1 = (word >> 8) & 0xFF;
                            const char2 = word & 0xFF;
                            if (char1 !== 0) str += String.fromCharCode(char1);
                            if (char2 !== 0) str += String.fromCharCode(char2);
                        }
                    }
                    return str;
                }
            case 'buffer':
                return buffer;
            case 'bits':
                {
                    const values = [];
                    for (let i = 0; i < buffer.length; i += 2) {
                        if (i + 1 < buffer.length) {
                            const word = buffer.readUInt16BE(i);
                            const bits = [];
                            for (let bit = 15; bit >= 0; bit--) {
                                bits.push((word & (1 << bit)) !== 0);
                            }
                            values.push(bits);
                        }
                    }
                    return values;
                }
            default:
                {
                    const values = [];
                    for (let i = 0; i < buffer.length; i += 2) {
                        if (i + 1 < buffer.length) {
                            values.push(buffer.readInt16BE(i));
                        }
                    }
                    return values;
                }
        }
    }

    function getFinsErrorDescription(errorCode) {
        const errors = {
            0x0001: "Service canceled",
            0x0101: "Local node not in network",
            0x0102: "Token timeout",
            0x0103: "Retries failed",
            0x0104: "Too many send frames",
            0x0105: "Node address range error",
            0x0106: "Node address duplication"
        };
        return errors[errorCode] || `Unknown error: 0x${errorCode.toString(16)}`;
    }

    function OmronFinsUdpNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        this.config = RED.nodes.getNode(config.connection);
        this.inputMode = config.inputMode || "node";
        this.operation = config.operation || "read";
        this.address = config.address || "";
        this.dataType = config.dataType || "DM";
        this.addressMode = config.addressMode || "single";
        this.addressList = config.addressList || [];
        this.dataFormat = config.dataFormat || "array";

        if (!this.config) {
            node.error("Missing FINS UDP configuration");
            return;
        }

        node.on('input', function (msg) {
            let operation, address, dataType;

            if (node.inputMode === "msg") {
                operation = msg.operation;
                address = msg.address;
                dataType = msg.dataType;

                if (!operation) {
                    node.error("Input Mode is 'Use Input Message' but msg.operation is missing", msg);
                    return;
                }
                if (!address) {
                    node.error("Input Mode is 'Use Input Message' but msg.address is missing", msg);
                    return;
                }
                // dataType can be optional if address is array with per-object dataType
                if (!dataType && !Array.isArray(address)) {
                    node.error("Input Mode is 'Use Input Message' but msg.dataType is missing", msg);
                    return;
                }
            } else {
                operation = node.operation;
                address = node.address;
                dataType = node.dataType;
            }

            let isMultiRead = false;
            if (operation === 'read') {
                if (Array.isArray(address)) {
                    isMultiRead = true;
                } else if (node.inputMode === 'node' && node.addressMode === 'multiple' && node.addressList.length > 0) {
                    isMultiRead = true;
                    address = node.addressList;
                }
            }

            if (!address) {
                node.error("Address is required", msg);
                return;
            }

            const socket = dgram.createSocket('udp4');
            let responseReceived = false;
            let retryCount = 0;
            let currentAddressInfo = null;
            let currentBitCount = null;
            let isWritingBits = false;
            let bitWriteData = null;

            // Multi-read support
            let multiReadResults = [];
            let multiReadIndex = 0;
            let addressList = isMultiRead ? address : null;

            function sendCommand(command) {
                socket.send(command, 0, command.length, node.config.port, node.config.host, function (err) {
                    if (err) {
                        socket.close();
                        node.status({ fill: "red", shape: "ring", text: "send error" });
                        node.error("Error sending UDP packet: " + err.message, msg);
                    }
                });
            }

            function performOperation() {
                try {
                    node.status({ fill: "yellow", shape: "dot", text: "sending" });

                    let command;
                    if (operation === "read") {
                        if (isMultiRead) {
                            const addrInfo = addressList[multiReadIndex];
                            const addr = typeof addrInfo === 'string' ? addrInfo : addrInfo.address;
                            const cnt = typeof addrInfo === 'object' && addrInfo.count ? addrInfo.count : (msg.count || 1);
                            const dt = typeof addrInfo === 'object' && addrInfo.dataType ? addrInfo.dataType : dataType;
                            const parsedAddr = parseAddress(addr);
                            currentAddressInfo = parsedAddr;
                            currentBitCount = cnt;
                            command = buildReadCommand(dt, addr, cnt, node.config, parsedAddr);
                        } else {
                            const parsedAddr = parseAddress(address);
                            currentAddressInfo = parsedAddr;
                            currentBitCount = msg.count || 1;
                            command = buildReadCommand(dataType, address, msg.count || 1, node.config, parsedAddr);
                        }
                        sendCommand(command);
                    } else if (operation === "write") {
                        const parsedAddr = parseAddress(address);
                        currentAddressInfo = parsedAddr;

                        if (parsedAddr.isBitAddress) {
                            isWritingBits = true;
                            bitWriteData = Array.isArray(msg.payload) ? msg.payload : [msg.payload];
                            currentBitCount = bitWriteData.length;

                            const startBit = parsedAddr.bitPosition;
                            const endBit = startBit + bitWriteData.length - 1;
                            const startWord = Math.floor(startBit / 16);
                            const endWord = Math.floor(endBit / 16);
                            const wordCount = endWord - startWord + 1;

                            command = buildReadCommand(dataType, address, wordCount, node.config, parsedAddr);
                        } else {
                            command = buildWriteCommand(dataType, address, msg.payload, node.config, parsedAddr);
                        }
                        sendCommand(command);
                    } else {
                        socket.close();
                        node.error("Invalid operation: " + operation, msg);
                        return;
                    }

                    const timeout = setTimeout(function () {
                        if (!responseReceived) {
                            retryCount++;
                            if (retryCount < node.config.retries) {
                                node.status({ fill: "yellow", shape: "ring", text: "retry " + retryCount });
                                performOperation();
                            } else {
                                socket.close();
                                node.status({ fill: "red", shape: "ring", text: "timeout" });
                                node.error("UDP timeout after " + retryCount + " retries", msg);
                            }
                        }
                    }, node.config.timeout);

                    socket.once('message', function (data) {
                        clearTimeout(timeout);
                        responseReceived = true;

                        try {
                            const responseBuffer = parseFinsResponse(data);

                            if (isWritingBits && operation === "write") {
                                isWritingBits = false;
                                const modifiedBuffer = modifyBitsInWords(responseBuffer, currentAddressInfo.bitPosition, bitWriteData);
                                const wordsToWrite = [];
                                for (let i = 0; i < modifiedBuffer.length; i += 2) {
                                    if (i + 1 < modifiedBuffer.length) {
                                        wordsToWrite.push(modifiedBuffer.readUInt16BE(i));
                                    }
                                }
                                const writeCmd = buildWriteCommand(dataType, address, wordsToWrite, node.config, currentAddressInfo);
                                sendCommand(writeCmd);
                                responseReceived = false;
                                return;
                            }

                            if (isMultiRead) {
                                const addrInfo = addressList[multiReadIndex];
                                const addr = typeof addrInfo === 'string' ? addrInfo : addrInfo.address;
                                const dt = typeof addrInfo === 'object' && addrInfo.dataType ? addrInfo.dataType : dataType;

                                let addrDataFormat;
                                if (typeof addrInfo === 'object' && addrInfo.dataFormat) {
                                    addrDataFormat = addrInfo.dataFormat;
                                } else if (node.inputMode === 'msg') {
                                    addrDataFormat = msg.dataFormat || 'array';
                                } else {
                                    addrDataFormat = node.dataFormat;
                                }

                                const formattedValue = formatData(responseBuffer, addrDataFormat, currentAddressInfo, currentBitCount);

                                multiReadResults.push({
                                    address: addr,
                                    dataType: dt,
                                    value: formattedValue
                                });

                                multiReadIndex++;

                                if (multiReadIndex < addressList.length) {
                                    node.status({ fill: "green", shape: "dot", text: "reading " + (multiReadIndex + 1) + "/" + addressList.length });
                                    responseReceived = false;
                                    retryCount = 0;
                                    performOperation();
                                    return;
                                }

                                socket.close();
                                msg.payload = multiReadResults;
                                node.send(msg);
                                node.status({ fill: "green", shape: "dot", text: "success" });
                            } else {
                                let dataFormat;
                                if (node.inputMode === 'msg') {
                                    dataFormat = msg.dataFormat || 'array';
                                } else {
                                    dataFormat = node.dataFormat;
                                }
                                const formattedValue = formatData(responseBuffer, dataFormat, currentAddressInfo, currentBitCount);
                                socket.close();
                                msg.payload = formattedValue;
                                node.send(msg);
                                node.status({ fill: "green", shape: "dot", text: "success" });
                            }
                        } catch (err) {
                            socket.close();
                            node.status({ fill: "red", shape: "ring", text: "error" });
                            node.error("Error: " + err.message, msg);
                        }
                    });
                } catch (err) {
                    socket.close();
                    node.status({ fill: "red", shape: "ring", text: "error" });
                    node.error("Error: " + err.message, msg);
                }
            }

            if (node.config.localPort) {
                socket.bind(node.config.localPort, function () {
                    performOperation();
                });
            } else {
                performOperation();
            }

            socket.on('error', function (err) {
                socket.close();
                node.status({ fill: "red", shape: "ring", text: "error" });
                node.error("UDP socket error: " + err.message, msg);
            });
        });
    }

    RED.nodes.registerType("omron-fins-udp", OmronFinsUdpNode);
};
