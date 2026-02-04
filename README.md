# node-red-lib-comm-omron-fins

Node-RED nodes for communicating with Omron PLCs using the FINS (Factory Interface Network Service) protocol over TCP/IP.

## Installation

### Using npm (when published)
```bash
npm install node-red-lib-comm-omron-fins
```

### Local Development
```bash
cd ~/.node-red
npm install /path/to/node-red-lib-comm-omron-fins
```

Then restart Node-RED.

## Nodes

### omron-fins

A node for reading and writing data to/from Omron PLCs using the FINS protocol.

#### Configuration

- **Connection**: Reference to an omron-fins-config node
- **Input Mode**: Controls parameter source
  - **Use Node Settings** (default): Uses the configured operation, data type, and address from the node settings
  - **Use Input Message**: Reads all parameters from the input message (msg.operation, msg.dataType, msg.address, etc.)
- **Operation**: Read, Write, or Change Mode operation (only used when Input Mode is "Use Node Settings")
- **Data Type**: Memory area type (CIO, WR, HR, AR, DM, EM)
- **Address**: Memory address to access (supports bit notation like "100.05" for bit 5 of word 100)

#### Input

**When Input Mode is "Use Node Settings":**
- The node uses its configured settings
- Input message properties are ignored

**When Input Mode is "Use Input Message":**
- All parameters must be provided in the input message:
  - `msg.operation` (string, required): "read", "write", or "mode"
  - `msg.dataType` (string, required for read/write): Memory area type (CIO, WR, HR, AR, DM, EM)
  - `msg.address` (string, required for read/write): Memory address (supports bit notation like "100.05")
  - `msg.count` (number, optional): Number of words/bits to read (default: 1)
  - `msg.dataFormat` (string, optional): Output format for read data (default: "array")
  - `msg.payload` (number|array|boolean, required for write): Data to write
  - `msg.mode` (string, required for mode operation): "RUN", "MONITOR", or "STOP"

**Data Format Options:**

| Format     | Description                                 | Output Type      |
| ---------- | ------------------------------------------- | ---------------- |
| `array`    | Signed 16-bit integers (default)            | Array of numbers |
| `unsigned` | Unsigned 16-bit integers (0-65535)          | Array of numbers |
| `int32`    | 32-bit signed integers (pairs of words)     | Array of numbers |
| `float32`  | IEEE 754 32-bit floats (pairs of words)     | Array of numbers |
| `binary`   | Binary string representation (16 bits each) | Array of strings |
| `hex`      | Hexadecimal string representation           | Array of strings |
| `ascii`    | ASCII text string                           | String           |
| `buffer`   | Raw Node.js Buffer object                   | Buffer           |
| `bits`     | Bit arrays (each word as 16 booleans)       | Array of arrays  |

#### Output

For read operations, the node outputs:
- `msg.payload` (number|array): The data read from the PLC

#### Examples

**Read 10 words from DM100:**
```javascript
msg.operation = "read";
msg.dataType = "DM";
msg.address = "100";
msg.count = 10;
msg.dataFormat = "unsigned"; // Optional: specify output format
return msg;
```

**Read bit 5 from DM100:**
```javascript
msg.operation = "read";
msg.dataType = "DM";
msg.address = "100.05";
msg.count = 1;
return msg; // Returns single boolean value
```

**Write values to DM200:**
```javascript
msg.operation = "write";
msg.dataType = "DM";
msg.address = "200";
msg.payload = [100, 200, 300];
return msg;
```

### omron-fins-config

Configuration node for Omron FINS connection settings.

#### Properties

- **Host**: IP address or hostname of the Omron PLC
- **Port**: FINS port number (default: 9600)
- **DA1**: Destination network address (default: 0)
- **DA2**: Destination node address (default: 0)
- **SA1**: Source network address (default: 0)
- **SA2**: Source node address (default: 0)
- **Timeout**: Connection timeout in milliseconds (default: 5000)

## Supported Memory Areas

| Code | Description          |
| ---- | -------------------- |
| CIO  | Core I/O area        |
| WR   | Work area            |
| HR   | Holding area         |
| AR   | Auxiliary area       |
| DM   | Data memory area     |
| EM   | Extended memory area |

## Requirements

- Node.js >= 14.0.0
- Node-RED >= 2.0.0

## Development

### Project Structure
```
node-red-lib-comm-omron-fins/
├── package.json
├── omron-fins.js              # Main node runtime
├── omron-fins.html            # Main node editor UI
├── omron-fins-config.js       # Config node runtime
├── omron-fins-config.html     # Config node editor UI
├── README.md
└── LICENSE
```

### Testing

To test the nodes locally:

1. Link the package to your Node-RED installation:
```bash
cd ~/.node-red
npm install /path/to/node-red-lib-comm-omron-fins
```

2. Restart Node-RED

3. The nodes should appear in the palette under the "industrial" category

## License

Apache-2.0

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Disclaimer

This is a basic implementation of the FINS protocol. For production use, you may want to:
- Add more comprehensive error handling
- Implement the complete FINS protocol specification
- Add support for more memory areas and data types
- Add unit tests
- Implement connection pooling for better performance

## Support

For issues and feature requests, please use the GitHub issue tracker.
