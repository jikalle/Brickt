# Contributing to Brickt

Thank you for your interest in contributing to Brickt. This document provides guidelines and instructions for contributing.

## Code of Conduct

- Be respectful and inclusive
- Welcome newcomers and help them learn
- Focus on constructive feedback
- Respect differing opinions and experiences

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/Brickt.git`
3. Add upstream remote: `git remote add upstream https://github.com/jikalle/Brickt.git`
4. Follow the [setup guide](./SETUP.md)

## Development Workflow

### 1. Create a Branch

```bash
git checkout -b feature/your-feature-name
```

Branch naming conventions:
- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation updates
- `refactor/` - Code refactoring
- `test/` - Test additions or updates

### 2. Make Changes

- Write clean, readable code
- Follow existing code style
- Add tests for new features
- Update documentation as needed

### 3. Test Your Changes

```bash
# Run all tests
pnpm test

# Test specific package
cd packages/frontend && pnpm test
cd packages/backend && pnpm test
cd packages/contracts && pnpm test

# Run linter
pnpm lint
```

### 4. Commit Changes

Use clear, descriptive commit messages:

```bash
git commit -m "feat: add multi-token support for investments"
git commit -m "fix: correct chain switching bug in navbar"
git commit -m "docs: update API documentation"
```

Commit message format:
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation
- `style:` - Formatting changes
- `refactor:` - Code restructuring
- `test:` - Test updates
- `chore:` - Build process or auxiliary tools

### 5. Push and Create Pull Request

```bash
git push origin feature/your-feature-name
```

Then create a Pull Request on GitHub with:
- Clear title and description
- Reference any related issues
- Screenshots for UI changes
- List of changes made

## Code Style Guidelines

### TypeScript/JavaScript

- Use TypeScript for type safety
- Follow functional programming patterns where possible
- Use meaningful variable and function names
- Keep functions small and focused
- Comment complex logic

Example:
```typescript
// Good
const calculateTokenPrice = (totalValue: bigint, tokenSupply: bigint): bigint => {
  return totalValue / tokenSupply;
};

// Avoid
const calc = (a: any, b: any) => a / b;
```

### React Components

- Use functional components with hooks
- Keep components small and reusable
- Use TypeScript interfaces for props
- Extract complex logic to custom hooks

Example:
```typescript
interface PropertyCardProps {
  property: Property;
  onInvest: (propertyId: string) => void;
}

export const PropertyCard: React.FC<PropertyCardProps> = ({ 
  property, 
  onInvest 
}) => {
  // Component implementation
};
```

### Solidity

- Follow OpenZeppelin patterns
- Add comprehensive comments
- Use events for important state changes
- Include NatSpec documentation

Example:
```solidity
/**
 * @notice Creates a new crowdfunding campaign
 * @param propertyToken Address of the property token
 * @param fundingGoal Target funding amount
 * @return campaignId The ID of the created campaign
 */
function createCampaign(
    address propertyToken,
    uint256 fundingGoal
) external returns (uint256 campaignId) {
    // Implementation
}
```

## Project Structure

Understanding the structure:

```
Brickt/
├── packages/
│   ├── frontend/          # React application
│   │   ├── src/
│   │   │   ├── components/  # Reusable components
│   │   │   ├── pages/       # Page components
│   │   │   ├── hooks/       # Custom hooks
│   │   │   ├── store/       # Redux store
│   │   │   └── services/    # API and Web3 services
│   ├── backend/           # Express API
│   │   ├── src/
│   │   │   ├── controllers/ # Route handlers
│   │   │   ├── services/    # Business logic
│   │   │   ├── models/      # Database models
│   │   │   └── routes/      # API routes
│   └── contracts/         # Smart contracts
│       ├── contracts/       # Solidity files
│       ├── deploy/          # Deployment scripts
│       └── test/            # Contract tests
```

## Testing Guidelines

### Frontend Tests

- Test user interactions
- Test state management
- Mock external dependencies
- Test edge cases

### Backend Tests

- Test API endpoints
- Test business logic
- Test database operations
- Test error handling

### Contract Tests

- Test all functions
- Test access control
- Test edge cases and failures
- Test gas optimization

## Documentation

When adding features:

1. Update relevant README files
2. Add JSDoc/NatSpec comments
3. Update API documentation
4. Add examples where helpful

## Pull Request Process

1. **Before submitting:**
   - All tests pass
   - Code is linted
   - Documentation updated
   - Commits are clean and descriptive

2. **PR Review:**
   - Address reviewer feedback
   - Keep discussion focused and professional
   - Update PR based on feedback

3. **After approval:**
   - Maintainers will merge your PR
   - Delete your branch after merge

## Issue Reporting

When reporting bugs:

1. Check if issue already exists
2. Use issue template
3. Provide:
   - Clear description
   - Steps to reproduce
   - Expected vs actual behavior
   - Screenshots if applicable
   - Environment details

## Feature Requests

When requesting features:

1. Check if already requested
2. Explain use case and benefits
3. Consider implementation approach
4. Be open to discussion

## Security Issues

**Do NOT open public issues for security vulnerabilities.**

Instead:
- Open a private security advisory on GitHub

## Community

- Join discussions in GitHub Discussions
- Ask questions in Issues
- Share ideas and feedback

## Recognition

Contributors will be:
- Added to CONTRIBUTORS.md
- Mentioned in release notes
- Recognized in community channels

## Questions?

- Open a GitHub Discussion
- Check existing documentation
- Ask in Issues (for project-specific questions)

Thank you for contributing to Brickt.
