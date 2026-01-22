# Contributing to Syncscribe

Thank you for considering contributing to Syncscribe!

## How to Contribute

### Reporting Bugs

If you find a bug, please create an issue with:
- Clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- System information (OS, Node version, etc.)

### Suggesting Features

Feature requests are welcome! Please:
- Check if the feature has already been requested
- Clearly describe the use case
- Explain how it would benefit users

### Pull Requests

1. **Fork the repository**
2. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. **Make your changes**
   - Follow the existing code style
   - Add comments for complex logic
   - Update documentation if needed
4. **Test your changes**
   - Test with at least one video file
   - Verify the generated subtitles are accurate
5. **Commit your changes**
   ```bash
   git commit -m "Add: Brief description of changes"
   ```
6. **Push to your fork**
   ```bash
   git push origin feature/your-feature-name
   ```
7. **Open a Pull Request**
   - Describe what the PR does
   - Reference any related issues

## Development Setup

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/syncscribe.git
cd syncscribe

# Install dependencies
npm install
pip install ffsubsync

# Create .env file
cp .env.example .env
# Add your OpenAI API key to .env

# Test with a sample video
node generate-and-sync.js -i "path/to/test-video.mkv"
```

## Code Style

- Use 2 spaces for indentation
- Follow existing naming conventions
- Add JSDoc comments for new functions
- Use descriptive variable names

## Testing

Before submitting a PR:
- Test with different video formats (.mkv, .mp4, .avi)
- Test with videos that have multiple audio tracks
- Verify timing synchronization works correctly
- Check that error messages are helpful

## Questions?

Feel free to open an issue for any questions about contributing!
