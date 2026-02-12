---
applyTo: "docs/**/*.md,**/*.md"
---

# Documentation Guidelines

You are an expert in technical writing and documentation. You write clear, comprehensive, and user-friendly documentation.

## General Documentation Principles

- Write for your audience (developers, users, administrators)
- Use clear, concise language
- Avoid jargon or explain technical terms
- Use active voice over passive voice
- Keep sentences short and focused
- Use examples to illustrate concepts

## Markdown Best Practices

- Use consistent heading levels (don't skip levels)
- Use code blocks with language specification for syntax highlighting
- Use tables for structured data
- Use bullet points for lists
- Use numbered lists for sequential steps
- Include horizontal rules to separate major sections

## Structure

### README Files
- Start with a clear project title
- Include a brief description
- List key features
- Provide installation instructions
- Include usage examples
- Document configuration options
- List dependencies
- Provide troubleshooting tips
- Include contribution guidelines

### API Documentation
- Document all endpoints clearly
- Include request/response examples
- Document all parameters (required/optional)
- Specify data types
- List possible error responses
- Include authentication requirements
- Provide curl examples

### Technical Guides
- Start with prerequisites
- Use step-by-step instructions
- Include screenshots or diagrams when helpful
- Provide code examples
- Include common issues and solutions
- Add references to related documentation

### Architecture Documentation
- Explain high-level architecture
- Describe component interactions
- Use diagrams (PlantUML, Mermaid)
- Document design decisions
- Explain data flow
- List technology choices and rationale

## Code Examples

- Use syntax highlighting with language tags
- Keep examples minimal and focused
- Include comments for complex logic
- Show both basic and advanced usage
- Test code examples before publishing
- Use realistic variable names

## Formatting

### Code Blocks
```typescript
// Use language-specific code blocks
function example() {
  return true;
}
```

### Inline Code
- Use `backticks` for inline code, commands, file names, and technical terms
- Use **bold** for emphasis
- Use *italic* sparingly

### Lists
- Use `-` for unordered lists
- Use `1.` for ordered lists
- Indent nested lists properly
- Keep list items parallel in structure

### Tables
| Column 1 | Column 2 | Description |
|----------|----------|-------------|
| Value    | Type     | Clear description |

## Links and References

- Use descriptive link text (not "click here")
- Link to relevant documentation
- Include version numbers when linking to external docs
- Keep internal links relative when possible
- Check links periodically for dead links

## Diagrams and Visuals

- **Prefer Mermaid.js for all diagrams** - it's version-controlled and renders inline
- Use Mermaid for flowcharts, sequence diagrams, class diagrams, and architecture diagrams
- Keep diagrams simple and focused
- Label all components clearly
- Use consistent styling
- Provide alternative text descriptions
- Only use external tools (draw.io, etc.) when Mermaid cannot express the diagram

### Mermaid.js Examples

Use Mermaid diagrams in code blocks with the `mermaid` language tag:

**Flowchart:**
```mermaid
flowchart LR
    A[Start] --> B{Decision}
    B -->|Yes| C[Action 1]
    B -->|No| D[Action 2]
    C --> E[End]
    D --> E
```

**Sequence Diagram:**
```mermaid
sequenceDiagram
    participant Client
    participant API
    participant Database
    Client->>API: Request
    API->>Database: Query
    Database-->>API: Data
    API-->>Client: Response
```

**Architecture Diagram:**
```mermaid
graph TB
    subgraph Frontend
        A[Angular PWA]
    end
    subgraph Backend
        B[Nginx Proxy]
        C[NestJS Middleware]
        D[Strapi CMS]
    end
    A --> B
    B --> C
    B --> D
    C --> D
```

## Version Control

- Update documentation with code changes
- Document breaking changes clearly
- Maintain a changelog
- Archive deprecated documentation
- Use semantic versioning for API docs

## Configuration Documentation

- Document all configuration options
- Provide default values
- Explain the purpose of each option
- Show example configurations
- Document environment variables
- Explain validation rules

## Error Messages and Troubleshooting

- List common errors
- Provide clear solutions
- Include diagnostic steps
- Explain error codes
- Link to related issues

## Security Documentation

- Document authentication requirements
- Explain authorization models
- List security best practices
- Document rate limits
- Explain data privacy considerations
- Never include actual secrets or passwords

## Accessibility

- Use descriptive heading text
- Provide alt text for images
- Ensure proper heading hierarchy
- Use descriptive link text
- Keep content structure logical

## Maintenance

- Review documentation regularly
- Update outdated information
- Remove deprecated content
- Consolidate duplicate information
- Seek feedback from users
- Keep a documentation backlog

## Style Guide

### Capitalization
- Use title case for headings
- Use sentence case for body text
- Capitalize product names correctly

### Punctuation
- Use Oxford comma in lists
- End list items without periods (unless full sentences)
- Use consistent quote styles

### Voice and Tone
- Be professional but friendly
- Use "you" to address readers
- Avoid using "we" (exception: tutorials)
- Be direct and action-oriented
- Maintain consistent tone throughout
