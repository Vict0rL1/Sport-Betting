// Matchers de DOM para `expect` (toBeInTheDocument, toHaveTextContent…) y
// limpieza del DOM entre tests.
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => cleanup())
