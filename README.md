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
- **Operation**: Read or Write operation
- **Data Type**: Memory area type (CIO, WR, HR, AR, DM, EM)
- **Address**: Memory address to access

#### Input

The node accepts messages with the following optional properties to override the configuration:

- `msg.operation` (string): "read" or "write"
- `msg.dataType` (string): Memory area type
- `msg.address` (string): Memory address
- `msg.count` (number): Number of words to read (read operation only, default: 1)
- `msg.payload` (number|array): Data to write (write operation only)

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
return msg;
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
